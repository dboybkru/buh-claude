# BuhClaude frontend — production image (nginx serving Vite build)
#
# Multi-stage:
#   builder — Node 20 alpine, runs `npm ci && npm run build`
#   runtime — nginx alpine, serves the SPA and proxies /api to backend
#
# Build args:
#   None at the moment. The app uses a relative `/api/v1` base, which nginx
#   reverse-proxies to the backend service. If you ever deploy frontend on a
#   different origin than the API, switch the axios base via VITE_API_URL and
#   wire it through here (`ARG VITE_API_URL` + `ENV` before `npm run build`).

# ─── 1. Builder ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY tailwind.config.ts postcss.config.cjs ./
COPY components.json ./
COPY index.html ./
COPY src ./src

RUN npm run build


# ─── 2. Runtime ──────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache wget

# Custom config: SPA fallback + reverse proxy for /api/* → backend service.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static SPA bundle from the builder.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck — just confirm nginx serves the SPA shell.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
