# ---------------------------------------------------------------------------
# rag-api image — the streaming backend (Cloud Run Service)
# ---------------------------------------------------------------------------
# Build stage 1: install dev deps (needed to run `tsc` for the compile step).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY lib ./lib
COPY src ./src
# Emit the compiled ESM into dist/ (lib + src). `noEmit`/`strict` guard TS; the
# build config controls emit. `dist/scripts` is excluded (smoke is dev-only).
RUN npm run build
# Prune build/dev-only deps: the runtime only needs the compiled output.
RUN npm prune --omit=dev

# Runtime stage: copy compiled output + production deps only.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Cloud Run expects the container to listen on $PORT (set at deploy time).
EXPOSE 8080
USER node
CMD ["node", "dist/src/server.js"]