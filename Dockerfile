# ── VedaAI backend — production image ──────────────────────────────────────
# Single image used by BOTH the web service (node dist/server.js) and the BullMQ
# worker (node dist/worker.js). The worker command is overridden in compose.
#
# Bundles assets/fonts/ — pdfkit's built-in Helvetica garbles the Unicode the model
# emits (Ω, ₹, π, superscripts), so PDF rendering needs DejaVuSans.{ttf,Bold.ttf},
# resolved from process.cwd()/assets/fonts. WORKDIR=/app makes cwd=/app at runtime.

# ── Stage 1: compile TypeScript → dist/ ──
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: lean runtime (prod deps + compiled JS + fonts) ──
FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY assets ./assets
# Mountpoint for the shared uploads volume (multer disk storage / worker fs.readFile).
RUN mkdir -p uploads

EXPOSE 5000

# Liveness: /api/health always returns 200 once the HTTP server is up. Uses Node's
# built-in http so we don't need curl/wget in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Default = web server. The worker service overrides this with: node dist/worker.js
CMD ["node", "dist/server.js"]
