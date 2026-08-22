# ---------------------------------------------------------------------------
# rag-api image — the streaming backend (Cloud Run Service)
# ---------------------------------------------------------------------------
# Build stage: install prod deps only (smaller final image, cached layer).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: copy deps + source.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY src ./src

# Cloud Run expects the container to listen on $PORT (set at deploy time).
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]