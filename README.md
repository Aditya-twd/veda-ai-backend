# VedaAI — Assessment Creator (Backend)

REST + realtime API for **VedaAI**, an AI-assisted assessment creator for teachers. A teacher
describes an assignment (subject, question types, marks, an optional reference document), and the
service generates a complete, structured **question paper with an answer key** — asynchronously,
with live progress — and can export it to **PDF**.

- **Frontend (live):** https://veda-ai-frontend-five.vercel.app
- **Frontend repo:** https://github.com/Aditya-twd/veda-ai-frontend
- **Architecture deep-dive:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **User manual:** [`USER_MANUAL.md`](./USER_MANUAL.md)
- **Deployment guide:** [`DEPLOY.md`](./DEPLOY.md)

---

## Highlights

- **Asynchronous generation** — paper generation runs as a background job (BullMQ on Redis), so the
  API stays responsive and a slow model call never blocks the request thread.
- **Live progress over WebSockets** — clients subscribe to an assignment and receive
  `started → progress → completed/failed` events in real time (Socket.IO).
- **Multimodal input** — an uploaded PDF or image is passed directly to the model, so papers can be
  generated *from a teacher's own material*.
- **Structured, validated output** — the model is constrained to JSON and every response is parsed
  and validated with Zod before it touches the database; malformed output is regenerated.
- **Never-fail UX** — if the generation provider is unavailable (quota, outage, bad key), the job
  falls back to a clearly-marked sample paper instead of erroring.
- **Google Sign-In + JWT auth**, with a one-click **guest** fallback so the app is never locked out.
- **PDF export** with proper Unicode (math symbols, ₹, Greek) via bundled fonts.
- **Boots without infrastructure** — the server starts even before MongoDB/Redis are configured and
  reports each subsystem on `/api/health`, which keeps local development and deployment friction low.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js 24, TypeScript |
| Web framework | Express |
| Database | MongoDB + Mongoose |
| Cache / queue broker | Redis (ioredis) |
| Background jobs | BullMQ |
| Realtime | Socket.IO (+ Redis pub/sub bridge across processes) |
| AI generation | Google Gemini (`@google/genai`, multimodal) |
| Validation | Zod |
| Auth | Google ID-token verification (`google-auth-library`) → app-issued JWT |
| Uploads | Multer (disk storage) |
| PDF | PDFKit (bundled DejaVu fonts) |
| Packaging | Docker (multi-stage) |

## Architecture at a glance

```
                              ┌──────────────────────────────┐
                              │   Web process (Express)       │
  Client ── HTTPS/WSS ───────▶│  REST API + Socket.IO         │
  (Next.js frontend)          │  validates, persists, ENQUEUE │
                              └───────┬───────────────▲───────┘
                                      │ add job        │ progress events
                                      ▼                │ (Redis pub/sub)
                              ┌───────────────┐   ┌────┴───────────────┐
                              │     Redis     │◀──│  Worker process    │
                              │  (BullMQ +    │   │  consumes jobs:    │
                              │   pub/sub)    │──▶│  AI generate → save│
                              └───────────────┘   └────┬───────────────┘
                                                       │
                              ┌───────────────┐        │
                              │   MongoDB     │◀───────┘
                              │ users /       │  persists assignment + paper
                              │ assignments / │
                              │ questionpapers│
                              └───────────────┘
```

The **web** and **worker** are separate processes built from the same image. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full request/generation lifecycle, data models, and
the design decisions behind each choice.

## Project structure

```
src/
  app.ts                 # Express app: middleware, route mounting, error handling
  server.ts              # Web entrypoint: HTTP server + Socket.IO + event bridge
  worker.ts              # Worker entrypoint: BullMQ consumers
  seed.ts                # Seeds the demo teacher
  config/                # env (Zod-validated), db, redis, socket
  middleware/            # requireAuth (JWT), error handler, multer upload
  models/                # Mongoose models: User, Assignment, QuestionPaper
  modules/
    auth/                # Google sign-in, guest, profile/onboarding
    assignment/          # assignment CRUD + "generate" trigger
    paper/               # fetch/edit papers, regenerate a section, PDF export
    upload/              # file upload endpoint
  ai/                    # Gemini client, prompt builders, Zod schema, parser, mock generator
  queues/                # generation queue, worker, Redis connection, event bridge
  pdf/                   # PDF rendering service
  sockets/               # Socket.IO event names + payload types
  utils/                 # logger, helpers
assets/fonts/            # DejaVuSans fonts bundled for PDF Unicode
```

## Getting started

### Prerequisites
- Node.js 20+ (developed on 24)
- Docker (for local MongoDB + Redis) — or use hosted MongoDB Atlas + Upstash Redis

### Install & configure
```bash
npm install
cp .env.example .env     # then fill in the values (see "Environment" below)
```

### Run local data stores
```bash
docker compose up -d     # MongoDB on :27017, Redis on :6379
npm run seed             # create the demo teacher (enables guest login)
```

### Run the app (two terminals)
```bash
npm run dev              # web API + Socket.IO  → http://localhost:5000
npm run worker           # BullMQ worker (generation jobs)
```

Verify: `curl http://localhost:5000/api/health` → all subsystems should read
`connected`/`configured`.

## Environment

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | – | `development` \| `production` |
| `PORT` | – | API port (default `5000`) |
| `CLIENT_URL` | prod | Allowed CORS / Socket.IO origin(s), comma-separated, **no trailing slash** |
| `MONGODB_URI` | yes* | MongoDB connection string |
| `REDIS_URL` | yes* | Redis URL (`redis://` or `rediss://` for TLS) |
| `GEMINI_API_KEY` | yes* | Google AI Studio key (omit → deterministic mock generator) |
| `GEMINI_MODEL` | – | Model id (default `gemini-2.5-flash`) |
| `GOOGLE_CLIENT_ID` | – | OAuth Web client id (omit → Google button disabled, guest still works) |
| `JWT_SECRET` | prod | Secret for signing JWTs (**required in production**) |
| `JWT_EXPIRES_IN` | – | Token lifetime (default `7d`) |
| `MAX_UPLOAD_MB` | – | Max upload size (default `10`) |

\* The server still boots without these (graceful degradation); features that need them are disabled
and reported on `/api/health`.

## API reference

Base path: `/api`. All responses use the envelope `{ "success": boolean, "data" | "error": ... }`.
Authenticated routes require `Authorization: Bearer <jwt>`.

### Auth — `/api/auth`
| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/google` | – | `{ credential }` | Verify a Google ID token, return `{ token, user }` |
| POST | `/guest` | – | – | Log in as the demo teacher, return `{ token, user }` |
| GET | `/me` | ✓ | – | Current user |
| PATCH | `/me` | ✓ | `{ school: { name, location?, sector? } }` | Onboarding — set school |

### Assignments — `/api/assignments`
| Method | Path | Auth | Body / Query | Description |
|---|---|---|---|---|
| POST | `/` | ✓ | `{ title, dueDate?, questionTypes[], additionalInstructions?, file? }` | Create a draft |
| GET | `/` | ✓ | `?q&status&page&limit` | List (filter + paginate) |
| GET | `/:id` | ✓ | – | Get one (includes `status`) |
| DELETE | `/:id` | ✓ | – | Delete |
| POST | `/:id/generate` | ✓ | – | Enqueue generation → `{ assignmentId, jobId, status: "queued" }` |

`questionTypes` items: `{ type: string, numQuestions: number>0, marks: number>0 }`.
`dueDate` accepts `DD-MM-YYYY` or any Date-parseable string.

### Papers — `/api/papers`
| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| GET | `/by-assignment/:assignmentId` | ✓ | – | Paper for an assignment |
| GET | `/:id` | ✓ | – | Get a paper |
| GET | `/:id/pdf` | ✓ | – | Download as PDF |
| PATCH | `/:id` | ✓ | full paper body | Save manual edits (recomputes marks, preserves school) |
| POST | `/:id/sections/:index/regenerate` | ✓ | `{ instruction? }` | Regenerate one section's questions |

### Upload — `/api/upload`
| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/` | ✓ | multipart, field `file` | Upload a PDF/image → returns `{ originalName, mimeType, path, size }` to attach to an assignment |

### Health — `/api/health`
Returns `{ status, uptime, services: { mongo, redis, gemini }, env }`.

## Realtime events (Socket.IO)

A client emits `subscribe { assignmentId }` to join that assignment's room, then receives:

| Event | Payload |
|---|---|
| `generation:started` | `{ assignmentId }` |
| `generation:progress` | `{ assignmentId, percent, stage }` |
| `generation:completed` | `{ assignmentId, paperId }` |
| `generation:failed` | `{ assignmentId, error }` |

`unsubscribe { assignmentId }` leaves the room. Events originate in the worker process and reach
connected web sockets via a Redis pub/sub bridge (see [`ARCHITECTURE.md`](./ARCHITECTURE.md)).

## Production

Two processes from a single Docker image — **web** (`node dist/server.js`) and **worker**
(`node dist/worker.js`) — sharing an uploads volume. Full instructions (MongoDB Atlas, Upstash
Redis, Coolify) are in [`DEPLOY.md`](./DEPLOY.md).

```bash
npm run build              # compile TS → dist/
npm run start              # web
npm run start:worker       # worker
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Web API with hot reload |
| `npm run worker` | Worker with hot reload |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run start` / `start:worker` | Run compiled web / worker |
| `npm run seed` | Seed the demo teacher |
| `npm run typecheck` | Type-check without emitting |

## License

MIT
