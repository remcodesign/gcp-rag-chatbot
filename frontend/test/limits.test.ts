import { describe, it, expect } from 'vitest';
import { secondsUntilReset } from '../lib/limits';
import { createRateLimiter, getSharedRateLimiter } from '../server/utils/rateLimit';

describe('secondsUntilReset', () => {
    it('returns the seconds until the window resets (happy)', () => {
        // resetAt = now + 30s -> 30
        expect(secondsUntilReset(1000 + 30_000, 1000)).toBe(30);
    });

    it('rounds up partial seconds (happy)', () => {
        // resetAt = now + 30.5s -> ceil(30.5) = 31
        expect(secondsUntilReset(1000 + 30_500, 1000)).toBe(31);
    });

    it('returns 0 when the window already reset (non-happy)', () => {
        expect(secondsUntilReset(1000, 2000)).toBe(0);
    });
});

describe('getSharedRateLimiter', () => {
    it('returns the SAME instance across calls (so messages + limits share counters)', () => {
        const a = getSharedRateLimiter({ windowMs: 60_000, maxPerIp: 20, maxPerSession: 10 });
        const b = getSharedRateLimiter({ windowMs: 60_000, maxPerIp: 20, maxPerSession: 10 });
        expect(a).toBe(b);
    });

    it('increments counters that a second handle observes (happy)', () => {
        const limiter = getSharedRateLimiter({ windowMs: 60_000, maxPerIp: 20, maxPerSession: 10 });
        // Simulate the messages route checking (increments) then the limits
        // route reading the same shared instance.
        limiter.check('1.2.3.4', 'session-1');
        limiter.check('1.2.3.4', 'session-1');
        const ip = limiter.ipWindow('1.2.3.4');
        const session = limiter.sessionWindow('session-1');
        expect(ip.count).toBe(2);
        expect(session.count).toBe(2);
    });

    it('rejects when the session budget is exceeded (non-happy)', () => {
        const limiter = createRateLimiter({ windowMs: 60_000, maxPerIp: 20, maxPerSession: 2 });
        expect(limiter.check('1.2.3.4', 'session-1').allowed).toBe(true);
        expect(limiter.check('1.2.3.4', 'session-1').allowed).toBe(true);
        const third = limiter.check('1.2.3.4', 'session-1');
        expect(third.allowed).toBe(false);
        expect(third.status).toBe(429);
        expect(third.reason).toBe('session rate limit exceeded');
    });
});
