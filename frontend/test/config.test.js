import { describe, it, expect } from 'vitest';
import { resolveApiBase } from '../src/lib/config.js';

describe('resolveApiBase', () => {
  it('returns the injected window global (deploy-time override)', () => {
    globalThis.window = { __RAG_API_BASE__: 'https://rag-api-abc.ez.a.run.app' };
    expect(resolveApiBase()).toBe('https://rag-api-abc.ez.a.run.app');
    delete globalThis.window;
  });

  it('falls back to empty (same-origin / dev) when nothing is set', () => {
    // In node there's no import.meta.env and no window global -> ''.
    expect(resolveApiBase()).toBe('');
  });
});