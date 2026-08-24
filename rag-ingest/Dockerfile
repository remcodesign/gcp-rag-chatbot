# ---------------------------------------------------------------------------
# rag-ingest image — the one-time corpus seeder (Cloud Run Job)
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
# build config controls emit.
RUN npm run build
# Prune build/dev-only deps: the runtime only needs the compiled output.
RUN npm prune --omit=dev

# Runtime stage: source + corpus + compiled output (Location 1 baked corpus).
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY corpus ./corpus

# The Job runs to completion; defaults CORPUS_DIR to the baked-in corpus.
# Corpus is COPYed to /app/corpus (WORKDIR=/app), so all CORPUS_DIR values
# must point there — Dockerfile ENV, cli.ts default, and the Job env in
# infra/cloud_run.tf must agree.
ENV CORPUS_DIR=/app/corpus
USER node
CMD ["node", "dist/src/cli.js"]