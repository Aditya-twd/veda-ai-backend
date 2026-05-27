# Deploying the VedaAI backend (Coolify + Atlas + Upstash)

The backend runs as **two services from one Docker image**:

| Service | Command | Public? |
|---|---|---|
| `web`    | `node dist/server.js` | Yes — gets the domain (HTTP + Socket.IO) |
| `worker` | `node dist/worker.js` | No  — BullMQ background jobs (AI generation) |

They **share an `uploads` volume** because the web service writes uploaded PDFs/images to
disk (multer) and the worker reads them back (`fs.readFile`) to feed Gemini. Data stores are
**external managed services**: MongoDB Atlas + Upstash Redis.

Files: [`Dockerfile`](./Dockerfile), [`.dockerignore`](./.dockerignore),
[`docker-compose.coolify.yml`](./docker-compose.coolify.yml).

> Build note: the image uses **`node:24`** to match the npm version (11.x) that wrote
> `package-lock.json`. Building on `node:22` (npm 10) fails `npm ci` with a phantom
> "lockfile out of sync" error — keep the base image on node 24 unless you regenerate the
> lock with npm 10.

---

## 1. MongoDB Atlas (free M0)

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user (username + password).
3. **Network Access** → allow your VPS IP (or `0.0.0.0/0` for a quick demo).
4. **Connect → Drivers** → copy the SRV string, add the db name `vedaai`:
   ```
   mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/vedaai?retryWrites=true&w=majority
   ```
   → this is `MONGODB_URI`.

## 2. Upstash Redis (free)

1. Create a Redis database at <https://console.upstash.com>.
2. Copy the **`rediss://` URL** (the *Redis protocol* one, **not** the REST URL):
   ```
   rediss://default:<password>@<host>.upstash.io:6379
   ```
   → this is `REDIS_URL`. (ioredis auto-enables TLS for `rediss://`; BullMQ already gets
   `maxRetriesPerRequest: null` in code — no changes needed.)

## 3. Push the backend to GitHub

Coolify deploys from git, so commit and push everything (the Dockerfile, compose, the
resynced lockfile, and the resilience changes):
```bash
git add -A && git commit -m "Add Coolify deploy (Dockerfile + compose) and Gemini fallback"
git push origin main
```
`.env` is gitignored — secrets go into Coolify env vars (next step), never the repo.

## 4. Coolify resource

1. New resource → **Docker Compose** → connect the `veda-ai-backend` repo.
2. Set the compose file path to **`docker-compose.coolify.yml`**.
3. Add the **environment variables** below (Coolify injects them into both services).
4. Assign your **domain** to the **`web`** service (port **5000**). Traefik handles the
   WebSocket upgrade automatically — no extra config.
5. Deploy. The `worker` service needs no domain.

### Environment variables (set in Coolify)

```
NODE_ENV=production
PORT=5000
CLIENT_URL=https://veda-ai-frontend-five.vercel.app,https://veda-ai-frontend-git-main-adityacode10-7823s-projects.vercel.app
MONGODB_URI=<your Atlas SRV string>
REDIS_URL=<your Upstash rediss:// URL>
GEMINI_API_KEY=<your Gemini key>
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_CLIENT_ID=<same Client ID as the frontend>
JWT_SECRET=<a long random string>     # REQUIRED in prod — the server refuses to boot without it
JWT_EXPIRES_IN=7d
MAX_UPLOAD_MB=10
```

> `CLIENT_URL` is the CORS + Socket.IO allow-list. Comma-separated, **no trailing slash**.

## 5. Point the frontend at the backend

Once the backend has a public URL (e.g. `https://api.yourdomain.com`):

1. **Vercel** → frontend project → Settings → Environment Variables:
   `NEXT_PUBLIC_API_URL = https://api.yourdomain.com` → **redeploy** the frontend
   (`NEXT_PUBLIC_*` is baked in at build time).
2. **Google Cloud Console** → the OAuth Client ID → **Authorized JavaScript origins** →
   add `https://veda-ai-frontend-five.vercel.app` (and the `…-git-main-…` preview URL if
   you use it), or Google Sign-In throws `origin_mismatch`. *Continue as guest* works
   without this.

## 6. Verify

```bash
curl https://api.yourdomain.com/api/health
# → {"success":true,"data":{"status":"ok","services":{"mongo":"connected","redis":"connected","gemini":"configured"},...}}
```
All three services should read `connected`/`configured`. Then exercise the deployed
frontend: guest login → create assignment → generate (watch the live progress) → output.
