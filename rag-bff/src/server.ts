/**
 * rag-bff HTTP server — Cloud Run Service entry point.
 *
 * Wraps the shared `ragBff` handler (also usable as a Cloud Function) in a
 * minimal Node `http` server so the BFF deploys as a Cloud Run Service, the
 * same model as rag-api/rag-ingest/frontend (Docker image → Artifact Registry →
 * Terraform). The handler rate-limits the expensive SSE POSTs and proxies them
 * to the private rag-api using the BFF's service identity (IAM).
 */

import http from "node:http";
import { ragBff } from "./handler.js";

const PORT = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  ragBff(req, res).catch((err) => {
    const e = err as Error;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  });
});

server.listen(PORT, () => {
  console.log(`rag-bff listening on :${PORT}`);
});
