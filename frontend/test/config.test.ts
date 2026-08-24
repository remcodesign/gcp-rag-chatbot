import { describe, it, expect, afterEach } from 'vitest';
import { resolveApiBase } from '../src/lib/config';

describe('resolveApiBase', () => {
  afterEach(() => {
    // @ts-expect-error cleaning the global stub after each test
    delete globalThis.window;
  });

  it('returns the injected window global (deploy-time override)', () => {
    (globalThis as { window?: unknown }).window = { __RAG_API_BASE__: 'https://rag-api-abc.ez.a.run.app' };
    expect(resolveApiBase()).toBe('https://rag-api-abc.ez.a.run.app');
  });

  it('falls back to empty (same-origin / dev) when nothing is set', () => {
    expect(resolveApiBase()).toBe('');
  });
});