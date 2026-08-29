/**
 * Rate limiter — bounds the expensive POSTs (LLM generation) at the BFF choke
 * point. A sliding-window counter keyed on client IP and session id. When a
 * key exceeds its budget within the window, the request is rejected with 429.
 *
 * In-memory and per-instance: the counters live in a closure `Map`, so they are
 * lost on scale-to-zero and are NOT shared across multiple BFF instances. This
 * is a best-effort bound for short bursts, not a hard, durable, global limit.
 * For a durable + global limit, move the counter to a shared store (e.g.
 * Firestore) — see Domain 7 §9.6.
 */

export interface RateLimiterOptions {
  /** Window length in ms (default 60_000). */
  windowMs?: number;
  /** Max requests per client IP within the window (default 20). */
  maxPerIp?: number;
  /** Max requests per session id within the window (default 10). */
  maxPerSession?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** HTTP status to return when not allowed (429). */
  status: number;
  /** Human-readable reason for the rejection. */
  reason?: string;
}

/** Current usage of a single limit key (IP or session). */
export interface LimitWindow {
  /** Requests used within the current window. */
  count: number;
  /** Max requests allowed within the window. */
  max: number;
  /** Epoch ms when the window resets (count back to 0). */
  resetAt: number;
}

export interface RateLimiter {
  /** Checks a request against the budget. Call before proxying. */
  check(ip: string, sessionId: string): RateLimitResult;
  /** Current usage for the client IP limit (for the POC sidebar). */
  ipWindow(ip: string): LimitWindow;
  /** Current usage for the session limit (for the POC sidebar). */
  sessionWindow(sessionId: string): LimitWindow;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** A minimal clock so tests can inject a fake time. */
export interface Clock {
  now(): number;
}

/**
 * Creates a sliding-window rate limiter. `clock` is injectable for
 * deterministic tests (defaults to `Date.now`).
 */
export function createRateLimiter(
  options: RateLimiterOptions = {},
  clock: Clock = { now: () => Date.now() },
): RateLimiter {
  const windowMs = options.windowMs ?? 60_000;
  const maxPerIp = options.maxPerIp ?? 20;
  const maxPerSession = options.maxPerSession ?? 10;

  const ipBuckets = new Map<string, Bucket>();
  const sessionBuckets = new Map<string, Bucket>();

  function hit(map: Map<string, Bucket>, key: string, max: number): boolean {
    const now = clock.now();
    const existing = map.get(key);
    if (!existing || now >= existing.resetAt) {
      map.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= max) return false;
    existing.count += 1;
    return true;
  }

  function check(ip: string, sessionId: string): RateLimitResult {
    if (!hit(ipBuckets, ip, maxPerIp)) {
      return { allowed: false, status: 429, reason: "ip rate limit exceeded" };
    }
    if (!hit(sessionBuckets, sessionId, maxPerSession)) {
      return {
        allowed: false,
        status: 429,
        reason: "session rate limit exceeded",
      };
    }
    return { allowed: true, status: 200 };
  }

  /** Reads a bucket as a `LimitWindow`, defaulting to a fresh window. */
  function windowOf(
    map: Map<string, Bucket>,
    key: string,
    max: number,
  ): LimitWindow {
    const now = clock.now();
    const existing = map.get(key);
    if (!existing || now >= existing.resetAt) {
      return { count: 0, max, resetAt: now + windowMs };
    }
    return { count: existing.count, max, resetAt: existing.resetAt };
  }

  function ipWindow(ip: string): LimitWindow {
    return windowOf(ipBuckets, ip, maxPerIp);
  }

  function sessionWindow(sessionId: string): LimitWindow {
    return windowOf(sessionBuckets, sessionId, maxPerSession);
  }

  return { check, ipWindow, sessionWindow };
}
