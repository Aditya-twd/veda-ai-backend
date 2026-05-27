# VedaAI Backend — Architecture & Build Plan

> AI Assessment Creator backend. Built to the spec in `../content/projectDetails.txt`.
> Frontend already lives in `../frontend` (Next.js + Zustand).

---

## 1. Decisions (locked)

| Topic | Choice | Notes |
|---|---|---|
| Language/Framework | **Node.js + Express + TypeScript** | per the brief |
| Database | **MongoDB + Mongoose** | assignments & generated papers |
| Cache / job state | **Redis (ioredis)** | also backs BullMQ |
| Background jobs | **BullMQ** | AI generation + PDF rendering |
| Realtime | **Socket.IO** | push generation progress to the UI |
| LLM | **Google Gemini** (`@google/genai`) | key provided later; **multimodal** → reads PDFs/images directly |
| File upload | **multer** (PDF/image) | fed straight to Gemini |
| Validation | **Zod** | request bodies + LLM JSON output |
| PDF export | **Puppeteer** (HTML template → PDF) | bonus; "proper formatting, not raw print" |
| Auth | **Deferred** | code structured so JWT drops in later (stub middleware injects a demo user for now) |
| Dev infra | **Docker Compose** (mongo + redis) | Linux |
| Deploy | **Coolify on a VPS** | Dockerfile; Traefik handles WebSocket upgrades |

---

## 2. Two concepts you asked about

### BullMQ (background job queue) — "the automation"
AI generation can take 10–40s. We must **not** make the HTTP request hang that long.
So instead:

1. The API quickly accepts the request, drops a **job** onto a Redis-backed queue, and returns immediately with a `jobId`.
2. A separate **worker** process pulls jobs off the queue one by one, does the slow work (call Gemini, parse, save), and reports progress.
3. If the server restarts, jobs survive in Redis and resume — that's the reliability win.

Think of it as a to-do list that workers chew through in the background, with automatic
retries on failure. We'll have two queues: `generation` (AI) and `pdf` (render).

### WebSocket / Socket.IO (realtime updates)
HTTP is one-shot: client asks, server answers, done. But while a job runs in the
background, we want to *push* updates to the browser without it asking repeatedly.
A **WebSocket** is a persistent two-way pipe. Flow:

- Browser opens a socket and joins a room (its user/assignment id).
- The worker emits events as the job progresses → the browser updates live
  (spinner → "generating" → renders the paper) with zero polling.

---

## 3. Folder structure

```
backend/
├── docker-compose.yml          # mongo + redis for local dev
├── Dockerfile                  # production image (Coolify)
├── .env.example                # all env vars documented
├── package.json
├── tsconfig.json
├── PLAN.md                     # this file
└── src/
    ├── config/
    │   ├── env.ts              # load + validate env (zod)
    │   ├── db.ts               # mongoose connect
    │   ├── redis.ts            # ioredis connection (shared)
    │   └── socket.ts           # socket.io server + redis adapter
    ├── models/
    │   ├── User.ts
    │   ├── Assignment.ts
    │   └── QuestionPaper.ts
    ├── modules/
    │   ├── assignment/
    │   │   ├── assignment.routes.ts
    │   │   ├── assignment.controller.ts
    │   │   ├── assignment.service.ts
    │   │   └── assignment.validation.ts
    │   ├── paper/
    │   │   ├── paper.routes.ts
    │   │   ├── paper.controller.ts
    │   │   └── paper.service.ts
    │   └── upload/
    │       └── upload.routes.ts
    ├── ai/
    │   ├── gemini.client.ts     # wraps @google/genai, structured-JSON config
    │   ├── prompt.builder.ts    # assignment(+file) → structured prompt
    │   ├── paper.schema.ts      # Zod schema the LLM must satisfy
    │   └── parser.ts            # validate/repair LLM JSON (never raw)
    ├── queues/
    │   ├── connection.ts        # BullMQ shared Redis connection
    │   ├── generation.queue.ts  # enqueue helper
    │   ├── generation.worker.ts # does the Gemini work + emits sockets
    │   ├── pdf.queue.ts
    │   └── pdf.worker.ts        # puppeteer render
    ├── sockets/
    │   └── events.ts            # event name constants + emit helpers
    ├── middleware/
    │   ├── auth.middleware.ts   # STUB now → injects demo user; real JWT later
    │   ├── validate.ts          # zod request validation
    │   ├── upload.middleware.ts # multer (pdf/image, size limit)
    │   └── error.middleware.ts  # central error handler
    ├── utils/
    │   ├── logger.ts
    │   └── ApiError.ts
    ├── seed.ts                  # seed demo teacher "John Doe / Delhi Public School"
    ├── app.ts                   # express app (routes, cors, middleware)
    ├── worker.ts                # standalone worker entrypoint (BullMQ)
    └── server.ts                # http + socket.io + start
```

---

## 4. Data models

### User  *(used now via a seeded demo account; real auth later)*
```ts
{
  name: string,                 // "John Doe"
  email: string (unique),
  passwordHash?: string,        // filled when auth is added
  role: "teacher",
  school: { name: string, location: string, sector?: string },
  avatarUrl?: string,
  timestamps
}
```

### Assignment
```ts
{
  userId: ObjectId → User,
  title: string,
  file?: { originalName, mimeType, path, size },   // uploaded PDF/image
  dueDate: Date,
  questionTypes: [{ type: string, numQuestions: number, marks: number }],
  additionalInstructions?: string,
  totalQuestions: number,       // derived
  totalMarks: number,           // derived
  status: "draft" | "queued" | "generating" | "completed" | "failed",
  jobId?: string,
  paperId?: ObjectId → QuestionPaper,
  timestamps
}
```

### QuestionPaper  *(structured AI result — never store/return raw LLM text)*
```ts
{
  assignmentId: ObjectId → Assignment,
  userId: ObjectId → User,
  meta: { school, subject, class, timeAllowed, maxMarks },
  sections: [{
    title: string,              // "Section A"
    instruction: string,        // "Attempt all questions..."
    questions: [{
      text: string,
      difficulty: "easy" | "moderate" | "hard",
      marks: number
    }]
  }],
  answerKey: [{ index: number, answer: string }],
  generatedBy: string,          // model id
  status: "completed" | "failed",
  timestamps
}
```

---

## 5. REST API

```
# Assignments
POST   /api/assignments            create (validated; computes totals)
GET    /api/assignments            list (search ?q=, filter, pagination)
GET    /api/assignments/:id        one
DELETE /api/assignments/:id        delete
POST   /api/assignments/:id/generate   → enqueue generation job, return { jobId }

# Upload (PDF / image)
POST   /api/upload                 multer; returns file ref to attach to an assignment

# Papers (generated result)
GET    /api/papers/:id             structured question paper + answer key
POST   /api/papers/:id/regenerate  re-run generation
GET    /api/papers/:id/pdf         enqueue/stream the rendered PDF

# Health
GET    /api/health                 db + redis ping

# (later) Auth
POST   /api/auth/register · /login · /logout · GET /me
```

All responses use a consistent shape: `{ success, data | error }`.

---

## 6. The end-to-end generation flow

```
[Frontend]                    [API]                  [Redis/BullMQ]        [Worker]                [Gemini]
   |  POST /assignments         |                          |                  |                       |
   |--------------------------> | save Assignment(draft)   |                  |                       |
   |  (optional) POST /upload   |                          |                  |                       |
   |  POST /:id/generate        |                          |                  |                       |
   |--------------------------> | status=queued; add job ->|                  |                       |
   | <----- { jobId } --------- |                          |-- job ---------> | build prompt(+file)   |
   |  open socket, join room    |                          |                  |---------------------->|
   | <== generation:started === |  (worker emits)          |                  | <==== JSON ===========|
   | <== generation:progress == |                          |                  | parse + Zod validate  |
   |                            |                          |                  | save QuestionPaper    |
   | <== generation:completed ==|  { paperId }             |                  | status=completed      |
   |  GET /papers/:id           |                          |                  |                       |
   |--------------------------> | return structured paper  |                  |                       |
```

On failure the worker retries (BullMQ backoff) then emits `generation:failed`.

### Socket.IO events
- Client → server: `join` (room = assignmentId or userId)
- Server → client: `generation:started`, `generation:progress` `{percent}`,
  `generation:completed` `{paperId}`, `generation:failed` `{message}`

---

## 7. AI integration (Gemini)

- **Multimodal input**: if the assignment has an uploaded PDF/image, we send the file
  bytes inline alongside the text prompt — Gemini reads the document natively (no separate
  OCR/pdf-parse step needed for most cases).
- **Structured output**: call Gemini with `responseMimeType: "application/json"` and a
  `responseSchema` so it returns JSON matching our paper shape.
- **Prompt builder** turns the form (question types, counts, marks, subject/class, due date,
  extra instructions) into a strict system+user prompt: "produce sections, questions,
  difficulty, marks, answer key as JSON; do not include prose."
- **Parser** validates the JSON against `paper.schema.ts` (Zod). If invalid → one repair
  retry, else mark failed. **The raw response is never sent to the client.**
- Model + key come from env (`GEMINI_API_KEY`, `GEMINI_MODEL`, default e.g. `gemini-2.0-flash`).

---

## 8. File upload

- `multer` accepts `application/pdf`, `image/png`, `image/jpeg`; size limit via env
  (`MAX_UPLOAD_MB`, default 10).
- Dev: stored under `backend/uploads/` (gitignored).
- Coolify: mount a persistent volume at `/app/uploads` (file is read by the worker during
  generation). File ref is saved on the Assignment.

---

## 9. Environment variables (`.env.example`)

```bash
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000        # CORS + socket origin

MONGODB_URI=mongodb://localhost:27017/vedaai
REDIS_URL=redis://localhost:6379

GEMINI_API_KEY=                         # <-- you'll provide this
GEMINI_MODEL=gemini-2.0-flash

MAX_UPLOAD_MB=10

# (later, when auth is added)
# JWT_SECRET=
# JWT_REFRESH_SECRET=
# JWT_EXPIRES_IN=15m
```

**Keys you actually need to obtain:** just the **Gemini API key** (from Google AI Studio).
Mongo + Redis run locally via Docker Compose — no signup.

---

## 10. Local dev & deployment

### Local (Docker Compose for data stores, Node runs on host)
```bash
docker compose up -d        # starts mongo + redis
npm run dev                 # API + socket (ts-node-dev/tsx)
npm run worker              # BullMQ worker (separate terminal)
```

### Coolify (VPS)
- One Git repo → Coolify builds the **Dockerfile**.
- Add **MongoDB** and **Redis** as Coolify one-click services; inject their URLs as env vars.
- Run **two resources** from the same image: `node dist/server.js` (web) and
  `node dist/worker.js` (worker).
- Traefik (Coolify's proxy) upgrades WebSocket connections automatically — just ensure
  `CLIENT_URL`/CORS is set. If we ever scale to >1 web instance, enable the Socket.IO
  **Redis adapter** (we already have Redis) for cross-instance event delivery.

---

## 11. Build roadmap (phased)

- **Phase 0 — Scaffold**: package.json, tsconfig, env loader, docker-compose, app/server boot, `/api/health`. *(no keys needed)*
- **Phase 1 — Data layer**: Mongo + Redis connections, models, seed demo user.
- **Phase 2 — Assignments**: CRUD + Zod validation + totals. *(frontend can integrate here)*
- **Phase 3 — Upload**: multer PDF/image endpoint.
- **Phase 4 — AI core**: Gemini client, prompt builder, paper schema, parser. *(needs Gemini key to run, but code can be written first)*
- **Phase 5 — Queue**: BullMQ generation queue + worker wiring.
- **Phase 6 — Realtime**: Socket.IO server + progress events end-to-end.
- **Phase 7 — PDF (bonus)**: Puppeteer render queue + `/papers/:id/pdf`.
- **Phase 8 — Deploy**: Dockerfile + Coolify config + README.
- **Phase 9 — Auth (later)**: swap the stub middleware for real JWT register/login.

We can build Phases 0–3 and 5–6 fully without the Gemini key (using a mock generator),
then plug the key into Phase 4 to go live.
```
