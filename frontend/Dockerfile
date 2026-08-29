# ---------------------------------------------------------------------------
# rag-frontend image — static Vue 3 chat UI (Cloud Run Service)
# ---------------------------------------------------------------------------
# Build stage: install deps + build the Vite app to /app/dist.
# The frontend now calls the BFF SAME-ORIGIN: nginx proxies /sessions/* and
# /limits/* to the BFF (rag-bff), which rate-limits and forwards to the private
# rag-api. So VITE_API_BASE defaults to EMPTY (same-origin) — no cross-origin
# call, no CORS. Override only for local dev against a deployed BFF.
FROM node:20-alpine AS build
ARG VITE_API_BASE=
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN VITE_API_BASE="$VITE_API_BASE" npm run build

# Runtime stage: serve the static build with nginx.
FROM nginx:1.27-alpine
# Copy the built assets into the nginx web root. SPA fallback: any non-asset
# path serves index.html (Vue history-mode routing isn't used, but this keeps
# deep links / refreshes working).
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
# Override the main nginx.conf to raise worker_connections (SSE streams are
# long-lived; the default 1024 is exhausted by concurrent streams -> 503).
COPY nginx.conf /etc/nginx/nginx.conf

# Cloud Run expects the container to listen on $PORT (set at deploy time).
# Cloud Run overrides this at runtime; the default here is for local runs.
# BFF_URL is the rag-bff origin the nginx proxy forwards /sessions/* to.
ENV PORT=8080
ENV BFF_URL=http://localhost:8081
EXPOSE 8080
CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BFF_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
