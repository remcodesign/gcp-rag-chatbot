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

import type { IncomingMessage, ServerResponse } from 'node:http';

interface FirestoreProbe {
    listCollections(): Promise<unknown>;
}

interface HealthDeps {
    firestore: FirestoreProbe;
}

interface HealthOptions {
    /** Readiness probe timeout in ms (default 2000). */
    readyTimeoutMs?: number;
}

interface HealthHandlers {
    handleLiveness(req: IncomingMessage, res: ServerResponse): void;
    handleReadiness(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** Writes a JSON response. */
function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/**
 * Creates the health handlers bound to a Firestore-shaped backend so `/readyz`
 * can probe a real dependency (not just return 200).
 */
export function createHealth(
    { firestore }: HealthDeps,
    options: HealthOptions = {},
): HealthHandlers {
    const readyTimeoutMs = options.readyTimeoutMs ?? 2000;
    type TimerHandle = ReturnType<typeof setTimeout> & { unref?: () => void };

    async function isReady(): Promise<boolean> {
        const timer: Promise<boolean> = new Promise((resolve) => {
            const t: TimerHandle = setTimeout(() => resolve(false), readyTimeoutMs);
            t.unref?.();
        });
        const attempt: Promise<boolean> = (async () => {
            try {
                await firestore.listCollections();
                return true;
            } catch {
                return false;
            }
        })();
        return Promise.race([attempt, timer]);
    }

    function handleLiveness(_req: IncomingMessage, res: ServerResponse): void {
        json(res, 200, { ok: true, service: 'rag-api', live: true });
    }

    async function handleReadiness(_req: IncomingMessage, res: ServerResponse): Promise<void> {
        const ready = await isReady();
        json(res, ready ? 200 : 503, { ok: ready, service: 'rag-api', ready });
    }

    return { handleLiveness, handleReadiness };
}
