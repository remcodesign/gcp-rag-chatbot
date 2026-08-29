/**
 * Nitro route — GET /api/limits/:sessionId
 *
 * POC: exposes the current rate-limit usage for the frontend sidebar.
 * Returns `{ ip: LimitWindow, session: LimitWindow }`. Normally you would NOT
 * expose rate-limit internals to the client; this is a POC affordance.
 */

import { defineEventHandler, getRouterParam, getRequestIP } from 'h3';
import { useRuntimeConfig } from '#imports';
import { getSharedRateLimiter } from '../../utils/rateLimit';

const config = useRuntimeConfig();
// Shared singleton so this route reads the SAME counters the messages route
// increments (a per-route instance would always report count: 0).
const limiter = getSharedRateLimiter({
    windowMs: config.rateWindowMs,
    maxPerIp: config.rateMaxPerIp,
    maxPerSession: config.rateMaxPerSession,
});

export default defineEventHandler((event) => {
    const sessionId = getRouterParam(event, 'id') ?? '';
    const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown';
    return {
        ip: limiter.ipWindow(ip),
        session: limiter.sessionWindow(sessionId),
    };
});
