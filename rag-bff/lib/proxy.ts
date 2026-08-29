/**
 * Proxy — forwards the SSE POST from the BFF to the private `rag-api` service.
 *
 * The BFF is the only caller of `rag-api` (which is private behind IAM). It
 * authenticates with its own service identity via an OIDC token in the
 * `Authorization: Bearer` header, which Cloud Run's IAM accepts. The response
 * is streamed back to the client so SSE frames flow through unchanged.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export interface ProxyDeps {
  /** The private rag-api base URL (e.g. https://rag-api-...run.app). */
  ragApiBase: string;
  /** Fetches an OIDC token for the BFF's service identity. */
  fetchIdToken(audience: string): Promise<string>;
}

export interface Proxy {
  /**
   * Forwards the request to rag-api and pipes the response back. Returns
   * true when the upstream handled it; false on an upstream error (caller
   * should write a 502).
   */
  forward(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<boolean>;
}

/**
 * Creates the proxy bound to the private rag-api. `fetchIdToken` is injectable
 * so tests can stub it (the real implementation uses the metadata server).
 */
export function createProxy(deps: ProxyDeps): Proxy {
  async function forward(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
  ): Promise<boolean> {
    const url = `${deps.ragApiBase}/sessions/${encodeURIComponent(sessionId)}/messages`;
    const token = await deps.fetchIdToken(deps.ragApiBase);

    // Collect the request body (the SSE POST carries a JSON payload).
    let body = "";
    for await (const chunk of req) body += chunk as string;

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body || "{}",
    });

    if (!upstream.ok && upstream.status !== 200) {
      // rag-api returns 200 for SSE (even on error frames); a non-200 here
      // means the upstream rejected the request (e.g. auth failure).
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `upstream ${upstream.status}` }));
      return false;
    }

    // Stream the SSE response back unchanged.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    }
    res.end();
    return true;
  }

  return { forward };
}
