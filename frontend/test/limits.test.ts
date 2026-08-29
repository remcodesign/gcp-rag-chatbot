import { describe, it, expect } from 'vitest';
import { secondsUntilReset } from '../src/lib/limits';

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
