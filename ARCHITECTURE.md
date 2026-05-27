# Architecture

This document explains how the VedaAI backend is structured, how a question paper is generated
end-to-end, the data model, and the reasoning behind the main design decisions.

## 1. Goals and constraints

The product requirement is simple to state and interesting to engineer: a teacher fills a short
form (optionally attaching their own material) and gets back a **complete, well-structured question
paper with an answer key**, which they can edit and export to PDF.

The hard parts:

- **The generation step is slow and unreliable.** A language-model call can take many seconds and
  can fail (rate limits, transient outages, malformed output). It must not block the API, and it
  must never leave the user staring at a spinner forever.
- **The user wants to watch it happen.** Progress should stream to the browser, not arrive in one
  lump at the end.
- **Output must be trustworthy.** Free-form model text can't be written straight to the database; it
  has to be coerced into a strict, validated shape.

These constraints drive the whole design: an **async job queue**, a **separate worker process**,
**realtime events**, and a **validate-or-regenerate-or-fallback** pipeline around the model.

## 2. Process model

The system runs as **two Node processes built from one codebase / one Docker image**:

| Process | Entry | Responsibility |
|---|---|---|
| **Web** | `src/server.ts` | HTTP REST API, auth, validation, persistence, **enqueues** generation jobs, hosts Socket.IO |
| **Worker** | `src/worker.ts` | Consumes jobs from the queue, calls the model, validates, persists the paper, **publishes** progress |

**Why split them?** Generation is CPU-light but latency-heavy and bursty. Keeping it out of the web
process means a flood of generations can't degrade API responsiveness, the two can be scaled
independently, and a crash in a job can't take down the API. In local development the worker can run
in-process for convenience, but in production they are distinct services (see `docker-compose.coolify.yml`).

Both processes start defensively: `connectDB()` and the Redis connection are **optional**. If a
store isn't configured the process still boots, logs a warning, and disables the dependent feature —
surfaced on `/api/health`. This keeps early development and incremental deployment painless.

## 3. Request lifecycle (synchronous APIs)

```
HTTP request
  → CORS (reflects any origin in dev; restricted to CLIENT_URL list in prod)
  → JSON body parsing
  → requireAuth (verifies Bearer JWT, attaches req.user)            [protected routes]
  → validate(schema) (Zod validates body/query/params)             [where defined]
  → controller (thin) → service (business logic) → Mongoose model
  → { success, data } envelope
  → notFoundHandler / errorHandler (consistent error envelope)
```

Controllers are intentionally thin; business logic lives in the module's `*.service.ts`. Every
mutating route is validated by a Zod schema via a single `validate()` middleware, so bad input is
rejected uniformly with a structured `{ success:false, error:{ message, details } }` body.

## 4. Generation flow (asynchronous)

This is the core path. A client creates an assignment, then triggers generation:

```
                                         WEB PROCESS
POST /assignments/:id/generate
   1. mark assignment status = "queued", store jobId
   2. generationQueue.add(job { assignmentId })  ──────────────┐
   3. respond 200 { jobId, status:"queued" }                   │
                                                                ▼
                                                          ┌───────────┐
                                                          │   Redis   │  (BullMQ)
                                                          └─────┬─────┘
                                       WORKER PROCESS            │ job delivered
   4. mark assignment "generating"; publish generation:started ◀┘
   5. load assignment (+ uploaded file from disk, if any)
   6. publish progress 50% "Generating questions"
   7. generatePaper(input):
        • build system + user prompt from the assignment
        • attach uploaded PDF/image inline (multimodal)
        • call the model with responseMimeType=application/json
        • parse + Zod-validate; on bad shape, regenerate once
        • on total failure → mock "sample" paper (source:"fallback")
   8. publish progress 80% "Saving paper"
   9. persist QuestionPaper (meta+sections+answerKey, generatedBy, isFallback)
  10. link paperId on the assignment; mark "completed"
  11. publish generation:completed { assignmentId, paperId }
        (on throw → mark "failed"; publish generation:failed)
```

The client, having subscribed over Socket.IO, sees `started → progress(50) → progress(80) →
completed` and then fetches the finished paper. A status-polling fallback on the client covers any
missed socket events.

## 5. Realtime: events across process boundaries

Progress events are produced in the **worker**, but the WebSocket connections live in the **web**
process. They don't share memory, so events are bridged through **Redis pub/sub**:

```
worker: publishEvent(progress) ──▶ Redis channel ──▶ web: event bridge subscriber
                                                          └─▶ io.to(room(assignmentId)).emit(...)
```

- Clients join a **per-assignment room** (`subscribe { assignmentId }`), so each browser only
  receives events for the assignment it's watching.
- `src/queues/events.bridge.ts` subscribes the web process to the Redis channel and re-emits to the
  right room. (When the worker runs in-process during development, it emits directly.)
- Reusing Redis — already present for BullMQ — avoids adding a second message broker.

## 6. AI integration

All model interaction is isolated in `src/ai/`, so the rest of the app depends only on a typed
`generatePaper()` / `regenerateSectionQuestions()` boundary, never on the SDK.

- **Prompting** (`prompt.ts`): a system instruction defines the role and the exact JSON contract; the
  user prompt is built from the assignment (title, question types + counts + marks, instructions,
  due date, school).
- **Multimodal**: if the assignment has an uploaded file, its bytes are attached inline to the
  request, so the model can generate questions grounded in the teacher's own document.
- **Structured output**: the call sets `responseMimeType: "application/json"` to constrain the model
  to JSON.
- **Validation** (`paper.schema.ts`, `parser.ts`): the response is parsed and validated with Zod. The
  schema is **defensive** — it `preprocess`es loose model output (coerces numbers/strings, normalizes
  difficulty to `easy|moderate|hard`, tolerates missing optional fields) before enforcing shape.
- **Retry**: a failed model call is retried with backoff; output that fails validation triggers **one
  regeneration** before giving up (lighter models occasionally emit off-schema JSON).
- **Fallback** (`generatePaper` returns `{ paper, source }`): if everything fails — quota exhausted,
  outage, revoked key, unparseable output — it returns a deterministic **mock** paper with
  `source:"fallback"`. The worker persists `isFallback:true`, and the UI marks it as a sample. The
  generation pipeline therefore **never hard-fails** for the end user.
- **No-key mode**: with no `GEMINI_API_KEY`, the same mock generator runs (`source:"mock"`), so the
  full pipeline (queue → worker → persistence → realtime) is exercisable without any credentials.

## 7. Data model (MongoDB / Mongoose)

```
User                         Assignment                       QuestionPaper
────                         ──────────                       ─────────────
name                         userId  ──────────────┐          assignmentId ──┐ (ref Assignment)
email (unique)               title                 │          userId  ───────┼─┐ (ref User)
googleId (sparse)            file? {originalName,   │          meta { school, subject, class,
provider: google|demo          mimeType, path,     │                 timeAllowed, maxMarks }
role: teacher|admin            size }               │          sections[] {
school? { name, location,    dueDate               │            title, instruction,
          sector }           questionTypes[] {      │            questions[] {
onboarded: bool                type, numQuestions,  │              text, difficulty(easy|moderate|hard),
avatarUrl                      marks }              │              marks, options[]  // MCQ choices
timestamps                   additionalInstructions │            } }
                             totalQuestions  ◀──────┘ derived   answerKey[] { index, answer }
                             totalMarks      ◀──────┘ (pre-save) generatedBy   // model id or "mock"
                             status: draft|queued|              isFallback: bool
                                queued|generating|              status: completed|failed
                                completed|failed                timestamps
                             jobId, paperId (ref QuestionPaper)
```

- **`Assignment` is the request; `QuestionPaper` is the result.** They're separate collections linked
  both ways (`assignment.paperId` ↔ `paper.assignmentId`) so the heavy generated content is fetched
  only when needed.
- `Assignment.totalQuestions` / `totalMarks` are **derived** in a `pre("save")` hook from
  `questionTypes`, keeping totals authoritative and never client-trusted.
- `answerKey` is **index-based** (`{ index, answer }`) rather than embedded per-question, so the
  answer key can be rebuilt cleanly when questions are added, removed, or regenerated during editing.
- `isFallback` exists purely to let the UI distinguish a real generation from a sample-paper fallback.

## 8. Authentication

```
Frontend (Google Identity Services) → Google ID token
   → POST /api/auth/google { credential }
   → google-auth-library verifies the token against GOOGLE_CLIENT_ID
   → upsert User (provider:"google"), issue app JWT
   → frontend stores { token, user } and sends Authorization: Bearer <jwt>
```

- The app issues and verifies **its own JWT** rather than passing the Google token around; `requireAuth`
  validates the Bearer token and attaches `req.user`.
- **Guest fallback** (`POST /auth/guest`) logs in as a seeded demo teacher (`provider:"demo"`,
  pre-onboarded) using `$set` upsert semantics, so a reviewer or a fresh database is never locked out.
- New Google users are `onboarded:false` until `PATCH /me` sets their school — the frontend routes them
  through an onboarding step.
- `JWT_SECRET` is required in production (the server refuses to boot without it); a dev fallback keeps
  local tokens valid across restarts.

## 9. File uploads

Uploads use **Multer disk storage** under `uploads/` (path resolved from the process working
directory). The web process stores the file and records `{ originalName, mimeType, path, size }` on
the assignment; the **worker later reads the file back from that path** to feed it to the model.

> **Deployment consequence:** because the web and worker are separate containers in production, they
> **share the `uploads` volume** — otherwise the worker couldn't see files the API wrote. This is wired
> in `docker-compose.coolify.yml`.

## 10. PDF export

`pdf/pdf.service.ts` renders a paper to PDF with **PDFKit**, using **bundled DejaVuSans fonts**
(`assets/fonts/`) instead of PDFKit's built-in Helvetica, which mangles the Unicode the model emits
(Greek letters, ₹, superscripts, π, ρ). Ligature substitution is disabled to avoid glyph dropouts, and
each question is measured before drawing so its text and its right-aligned `[difficulty] [marks]` label
never split across a page break. Authenticated download is handled by the client fetching the route
with the Bearer header and saving the resulting blob (a plain link can't send the header).

## 11. Configuration & operational notes

- **Env** is parsed and validated once at boot with Zod (`config/env.ts`); invalid configuration fails
  fast. Data-store and key values are optional to enable graceful degradation.
- **CORS** reflects any origin in development and is restricted to the `CLIENT_URL` allow-list in
  production (applied identically to HTTP and Socket.IO).
- **Health** (`/api/health`) reports `mongo`, `redis`, and `gemini` status — used by container health
  checks and quick diagnostics.
- **Redis over TLS**: `rediss://` URLs (e.g. Upstash) enable TLS automatically; BullMQ connections set
  `maxRetriesPerRequest: null` as the client requires.

## 12. Design decisions & trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| Job queue + separate worker | Slow/bursty generation must not block or crash the API; independent scaling | More moving parts (Redis, two processes) |
| Redis pub/sub event bridge | Reuse existing Redis to cross the web↔worker process boundary for realtime | Events are best-effort; client also polls status as a safety net |
| Validate-or-regenerate-or-fallback | Model output is untrusted and providers fail; users must always get a result | A fallback paper is generic, not tailored — but clearly labelled |
| App-issued JWT (not Google token) | Single auth model, decouples sessions from the IdP | JWT in localStorage on the client (XSS trade-off accepted for scope) |
| Disk uploads + shared volume | Model needs the raw bytes; simple and dependency-free | Requires a shared volume across containers (vs. object storage) |
| Boots without infra | Low-friction local dev and incremental deploy | Some endpoints are inert until stores are configured |
| Derived totals in a pre-save hook | Totals stay authoritative server-side | Slightly more model logic |
