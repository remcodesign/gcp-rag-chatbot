/**
 * Rate-limit info for the POC sidebar.
 *
 * The BFF exposes `GET /limits/:sessionId` returning the current usage of the
 * two rate-limit windows (client IP + session). This is a POC affordance —
 * normally you would NOT expose rate-limit internals to the client. The
 * frontend polls it to show "IP: X / 20" and "Session: X / 10" rows with a
 * reset countdown.
 */

import { resolveApiBase } from './config';

/** A single rate-limit window (count / max / reset epoch ms). */
export interface LimitWindow {
    count: number;
    max: number;
    resetAt: number;
}

/** The two windows the BFF reports for a session. */
export interface LimitInfo {
    ip: LimitWindow;
    session: LimitWindow;
}

/**
 * Fetches the current rate-limit usage for a session from the BFF.
 * Returns null when the endpoint is unreachable (e.g. BFF not deployed yet),
 * so the sidebar degrades gracefully.
 */
export async function fetchLimits(sessionId: string): Promise<LimitInfo | null> {
    const base = resolveApiBase();
    try {
        const res = await fetch(`${base}/limits/${encodeURIComponent(sessionId)}`);
        if (!res.ok) return null;
        return (await res.json()) as LimitInfo;
    } catch {
        return null;
    }
}

/** Seconds until a window resets (0 when already reset). */
export function secondsUntilReset(resetAt: number, now = Date.now()): number {
    return Math.max(0, Math.ceil((resetAt - now) / 1000));
}
