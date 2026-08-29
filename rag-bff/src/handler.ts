/**
 * rag-bff handler — the shared request handler.
 *
 * Public choke point in front of the private `rag-api`. It rate-limits the
 * expensive SSE POSTs (per client IP + per session) and proxies them to
 * `rag-api` using the BFF's service identity (IAM). The frontend calls this
 * same-origin via nginx; `rag-api` itself is private and reachable only by the
 * BFF.
 *
 * This handler is framework-agnostic: it is wrapped by `src/server.ts` (Cloud
 * Run Service) and could equally be exported as a Cloud Function entry.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createRateLimiter } from "../lib/rateLimit.js";
import { createProxy } from "../lib/proxy.js";

const RAG_API_BASE = process.env.RAG_API_BASE ?? "";
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const RATE_MAX_PER_IP = Number(process.env.RATE_MAX_PER_IP ?? 20);
const RATE_MAX_PER_SESSION = Number(process.env.RATE_MAX_PER_SESSION ?? 10);

/**
 * Fetches an OIDC token for the BFF's service identity, targeting the rag-api
 * audience. On Cloud Run the metadata server is reachable at
 * `http://metadata.google.internal`. Falls back to the local metadata server
 * for local dev.
 */
async function fetchIdToken(audience: string): Promise<string> {
  const base =
    process.env.GCE_METADATA_HOST ?? "http://metadata.google.internal";
  const url = `${base}/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const res = await fetch(url, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) {
    throw new Error(`metadata token fetch failed: ${res.status}`);
  }
  return res.text();
}

const limiter = createRateLimiter({
  windowMs: RATE_WINDOW_MS,
  maxPerIp: RATE_MAX_PER_IP,
  maxPerSession: RATE_MAX_PER_SESSION,
});
const proxy = createProxy({ ragApiBase: RAG_API_BASE, fetchIdToken });

/** Extracts the client IP from the request (Cloud Run sets X-Forwarded-For). */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"] as string | undefined;
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

/** Extracts the session id from the path `/sessions/:id/messages`. */
function sessionIdFromPath(pathname: string): string {
  return pathname.replace(/^\/sessions\//, "").replace(/\/messages$/, "");
}

/**
 * The shared request handler. Cloud Run calls this via `src/server.ts`; a
 * Cloud Function would call it directly with an Express-style (req, res).
 */
export async function ragBff(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  // POC: expose the current rate-limit usage for the frontend sidebar.
  // GET /limits/:sessionId -> { ip: LimitWindow, session: LimitWindow }.
  // Normally you would NOT expose this to the client; it is a POC affordance.
  if (req.method === "GET" && url.pathname.startsWith("/limits/")) {
    const sessionId = url.pathname
      .replace(/^\/limits\//, "")
      .replace(/\/$/, "");
    const ip = clientIp(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ip: limiter.ipWindow(ip),
        session: limiter.sessionWindow(sessionId),
      }),
    );
    return;
  }

  // Only the SSE POST is proxied; everything else is a 404.
  if (req.method !== "POST" || !url.pathname.startsWith("/sessions/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const sessionId = sessionIdFromPath(url.pathname);
  const ip = clientIp(req);

  // Rate-limit before proxying: the expensive LLM call must not run if the
  // caller is over budget.
  const verdict = limiter.check(ip, sessionId);
  if (!verdict.allowed) {
    res.writeHead(verdict.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: verdict.reason }));
    return;
  }

  try {
    await proxy.forward(req, res, sessionId);
  } catch (err) {
    const e = err as Error;
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}
