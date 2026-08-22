/**
 * Health endpoints — liveness & readiness for the rag-api service.
 *
 * Modern kubelet-style naming (/livez, /readyz) is used because it is explicit
 * and — unlike `/healthz` — is NOT reserved/intercepted by Cloud Run's global
 * front-end, so the container (not the edge) answers them publicly.
 *
 *   GET /livez   -> always 200 while the process is up (liveness).
 *   GET /readyz  -> 200 when ready (dependency reachable: Firestore), else 503.
 *   GET /health  -> alias for readiness.
 *
 * The readiness probe gently verifies the Firestore dependency so the service
 * reports "not ready" instead of silently failing if the datastore is down.
 */

/** Writes a JSON response. */
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Creates the health handlers bound to a Firestore-shaped backend so `/readyz`
 * can actually probe a real dependency (not just return 200 blindly).
 *
 * @param {object} deps
 * @param {object} deps.firestore  Firestore instance (real or fake) w/ `.listCollections()`.
 * @param {object} [options]
 * @param {number} [options.readyTimeoutMs]  readiness probe timeout (default 2000).
 * @returns {{ handleLiveness, handleReadiness }}
 */
export function createHealth({ firestore }, options = {}) {
  const readyTimeoutMs = options.readyTimeoutMs ?? 2000;

  async function isReady() {
    // A light, read-only Firestore call: listCollections proves the datastore
    // connection works. If it throws or times out, we report not-ready (503).
    const timer = new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), readyTimeoutMs);
      if (t.unref) t.unref();
    });
    const attempt = (async () => {
      try {
        await firestore.listCollections?.();
        return true;
      } catch {
        return false;
      }
    })();
    return Promise.race([attempt, timer]);
  }

  /** Liveness: process is up. Deliberately no dependencies. */
  function handleLiveness(req, res) {
    json(res, 200, { ok: true, service: 'rag-api', live: true });
  }

  /** Readiness: dependencies reachable. 200 if ready, else 503. */
  async function handleReadiness(req, res) {
    const ready = await isReady();
    json(res, ready ? 200 : 503, { ok: ready, service: 'rag-api', ready });
  }

  return { handleLiveness, handleReadiness };
}