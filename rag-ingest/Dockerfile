# ---------------------------------------------------------------------------
# rag-ingest image — the one-time corpus seeder (Cloud Run Job)
# ---------------------------------------------------------------------------
# Build stage: prod deps only.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: source + corpus (baked into the image, Location 1).
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY src ./src
COPY corpus ./corpus

# The Job runs to completion; defaults CORPUS_DIR to the baked-in corpus.
ENV CORPUS_DIR=/corpus
USER node
CMD ["node", "src/cli.js"]