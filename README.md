# VedaAI Backend

API for the VedaAI Assessment Creator — Express + TypeScript, MongoDB, Redis, BullMQ,
Socket.IO, and Google Gemini. See [`PLAN.md`](./PLAN.md) for the full architecture & roadmap.

> The server **boots without a database** during early development. Endpoints that need
> Mongo/Redis report their status via `/api/health`; configure the stores when you're ready.

## Requirements
- Node.js 20+ (tested on 24)
- Docker (for local MongoDB + Redis) — optional until you wire up the DB

## Setup
```bash
npm install
cp .env.example .env      # fill values in as you go
```

## Run (development)
```bash
npm run dev        # API + (later) Socket.IO  →  http://localhost:5000
npm run worker     # BullMQ worker (separate terminal; needs Redis)
```
Health check: `GET http://localhost:5000/api/health`

## Data stores (when ready)
```bash
docker compose up -d       # starts mongo + redis locally
# then set in .env:
#   MONGODB_URI=mongodb://localhost:27017/vedaai
#   REDIS_URL=redis://localhost:6379
npm run seed               # creates the demo teacher (John Doe / DPS Bokaro)
```

## Authentication (Google Sign-In + JWT)

Users sign in with Google on the frontend; the Google **ID token** is verified here, and we
issue our **own JWT** (sent back as `Authorization: Bearer <jwt>`). A **"Continue as guest"**
option logs in as the seeded demo teacher so the app is never blocked.

**Endpoints** (`/api/auth`): `POST /google` (body `{ credential }`), `POST /guest`,
`GET /me`, `PATCH /me` (onboarding — sets the user's school).

### One-time Google Cloud setup (free, ~3 min)
1. <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → OAuth consent screen** → *External* → fill app name + support email →
   add your own Google account under **Test users** (while the app is in "Testing").
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application**.
4. Under **Authorized JavaScript origins** add the frontend origin(s) — currently
   **`http://localhost:3000`** (plus `http://localhost:3001` and your deployed URL as needed).
   *The GIS ID-token button uses JS origins, not redirect URIs — no redirect URI required.*
5. Copy the **Client ID** into BOTH:
   - `backend/.env` → `GOOGLE_CLIENT_ID=...`
   - `frontend/.env.local` → `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...` (same value)
6. Set `JWT_SECRET` in `backend/.env` (any long random string; **required in production**).

> If `GOOGLE_CLIENT_ID` is unset the server still boots and guest login works — only the
> Google button is disabled. Socket.IO is not auth-gated yet (rooms are keyed by assignment id);
> that's a future hardening step.

## Build / production
```bash
npm run build              # → dist/
npm run start              # node dist/server.js  (web)
npm run start:worker       # node dist/worker.js  (jobs)
```

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | API with hot reload (tsx watch) |
| `npm run worker` | BullMQ worker with hot reload |
| `npm run build` | Compile TS → `dist/` |
| `npm run start` / `start:worker` | Run compiled web / worker |
| `npm run seed` | Seed the demo user (needs DB) |
| `npm run typecheck` | `tsc --noEmit` |

## Status — build phases (see PLAN.md §11)
- [x] **Phase 0** — Scaffold: env, config, app/server/worker boot, `/api/health`
- [x] **Phase 1** — Data layer: Mongoose models (User, Assignment, QuestionPaper), DB/Redis connectors (graceful), seed script
- [ ] **Phase 2** — Assignment CRUD + validation
- [ ] **Phase 3** — File upload (multer, PDF/image)
- [ ] **Phase 4** — Gemini AI core (prompt builder, parser)
- [ ] **Phase 5** — BullMQ generation queue + worker
- [ ] **Phase 6** — Socket.IO realtime events
- [ ] **Phase 7** — PDF export (Puppeteer)
- [ ] **Phase 8** — Dockerfile + Coolify deploy
- [x] **Phase 9** — Auth: Google Sign-In → verified ID token → our JWT (Bearer), with guest fallback
# veda-ai-backend
# veda-ai-backend
# veda-ai-backend
