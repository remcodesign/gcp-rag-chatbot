import { describe, it, expect } from 'vitest';
import { resolveApiBase } from '../src/lib/config';

describe('resolveApiBase', () => {
    it('returns empty (same-origin via the nginx proxy to the BFF) by default', () => {
        expect(resolveApiBase()).toBe('');
    });
});
