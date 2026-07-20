# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build for the Next.js 16 app using `output: 'standalone'`.
# Produces a slim, production-ready image suitable for self-hosting behind
# Cloudflare Tunnel / CDN.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine
# Pin pnpm to match the version that generated pnpm-lock.yaml (lockfileVersion 9.0).
# Corepack otherwise fetches the latest pnpm, which rejects the lockfile.
ARG PNPM_VERSION=10.30.0

# ── deps: install production + build dependencies with pnpm ───────────────────
FROM node:${NODE_VERSION} AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
# Only the manifests, so this layer is cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder: compile the standalone server bundle ────────────────────────────
FROM node:${NODE_VERSION} AS builder
ARG PNPM_VERSION
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Telemetry off keeps builds deterministic and offline-friendly.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── runner: minimal runtime image ────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output does NOT include `public` or `.next/static` — copy them in.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Writable data dir for persisted analysis results (lib/store.ts writes here).
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3001

# server.js is emitted by Next.js standalone output.
CMD ["node", "server.js"]
