# ---------------------------------------------------------------------------
# rag-frontend image — Nuxt 3 (SSR + Nitro BFF) Cloud Run Service
# ---------------------------------------------------------------------------
# The Nuxt app renders server-side and its Nitro server layer is the BFF: it
# rate-limits and proxies the SSE stream to the private rag-api server-to-server.
# No nginx, no separate BFF service. The browser talks to Nuxt same-origin.
#
# Build stage uses Node 22 on a glibc base (node:22-slim, not alpine). Nuxt
# 3.21 requires ^20.19 || >=22.12, and its toolchain (oxc-parser, oxc-transform,
# oxc-minify, lightningcss, @tailwindcss/oxide, rollup) ships native bindings as
# npm optional dependencies. npm 10's optional-deps bug (npm/cli#4828) skips
# them during `npm ci`, so `nuxt prepare`/`nuxt build` fail with "Cannot find
# native binding". Upgrade to npm 11 (which fixes the bug and matches the
# package-lock.json, generated with npm 11) before installing.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install -g npm@11 && npm ci
COPY . .
RUN npm run build

# Runtime stage: run the compiled Nuxt/Nitro server.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json

# Cloud Run expects the container to listen on $PORT (set at deploy time).
ENV PORT=8080
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
