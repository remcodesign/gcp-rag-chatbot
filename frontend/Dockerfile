# ---------------------------------------------------------------------------
# rag-frontend image — static Vue 3 chat UI (Cloud Run Service)
# ---------------------------------------------------------------------------
# Build stage: install deps + build the Vite app to /app/dist.
# VITE_API_BASE is the SSE backend origin baked into the bundle at build time
# (the frontend and backend are separate Cloud Run Services). Override with
# `--build-arg VITE_API_BASE=https://rag-api-...run.app`.
FROM node:20-alpine AS build
ARG VITE_API_BASE=https://rag-api-4xxip75eoa-ez.a.run.app
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

# Cloud Run expects the container to listen on $PORT (set at deploy time).
# Cloud Run overrides this at runtime; the default here is for local runs.
ENV PORT=8080
EXPOSE 8080
CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
