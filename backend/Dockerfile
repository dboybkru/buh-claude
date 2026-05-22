# BuhClaude backend — production image
#
# Multi-stage:
#   builder — installs all deps (incl. dev), runs prisma generate + tsc
#   runtime — copies built dist + production node_modules + prisma engine
#
# Result: ~250 MB Node 20 alpine image, runs as non-root, no source / .env / tests.

# ─── 1. Builder ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Build deps for native modules (bcrypt) + OpenSSL for Prisma engine.
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

# Install full deps from a clean lockfile (deterministic, no source yet).
COPY package.json package-lock.json ./
RUN npm ci

# Prisma client generation needs only the schema, not the rest of the source.
COPY prisma ./prisma
RUN npx prisma generate

# Now bring the source and build TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev deps so we copy only the production tree into the runtime stage.
RUN npm prune --omit=dev


# ─── 2. Runtime ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# OpenSSL is required by the Prisma query engine binary at runtime.
# wget is used by docker-compose healthcheck against /api/v1/health.
RUN apk add --no-cache openssl wget tini

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    UPLOADS_DIR=/app/uploads

# Copy only what the running server needs.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Persisted uploads — mounted as a volume in compose.
# Created with permissions the `node` user can write to.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 3001

# Healthcheck hits the unauthenticated liveness endpoint.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD wget -qO- http://127.0.0.1:3001/api/v1/health > /dev/null || exit 1

# tini reaps zombies and forwards signals to node (clean SIGTERM shutdown).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
