import { describe, it, expect } from 'vitest';
import { normalizeTrace, describeClassification, formatScore } from '../src/lib/trace';
import type { RawTrace, TraceClassification } from '../src/types/trace';

describe('describeClassification', () => {
  it('renders a self-contained reason', () => {
    const label = describeClassification({ rewrite: false, reason: 'self-contained query; no rewrite needed' });
    expect(label).toContain('self-contained');
  });

  it('renders a rewrite needed signal', () => {
    const label = describeClassification({ rewrite: true, reason: 'ambiguous pronoun with prior context' });
    expect(label).toContain('needs rewrite');
  });

  it('handles a missing classification', () => {
    expect(describeClassification(null)).toContain('self-contained');
  });
});

describe('normalizeTrace', () => {
  const fullTrace: RawTrace = {
    query: 'return policy',
    classification: { rewrite: false, reason: 'self-contained' },
    retrieved: [
      { id: 'a', title: 'Return', url: '/a', score: 0.9, textPreview: '...', chars: 20, keptInContext: true, rank: 1, category: null, text: '' },
    ],
    rerank: { didRerank: false, reason: 'above threshold' },
    context: { sources: [{ n: 1, id: 'a' }], length: 10 },
    timings: { embed: 1, retrieval: 2, rerank: 3, total: 6 },
    timedOut: false,
    finalPrompt: ['[1] system\nhi', '[3] user\nq'],
  };

  it('shapes a full trace payload for rendering', () => {
    const trace = normalizeTrace(fullTrace);
    expect(trace?.query).toBe('return policy');
    expect(trace?.retrieved).toHaveLength(1);
    expect(trace?.finalPrompt).toContain('[1] system');
    expect(trace?.timings?.embed).toBe(1);
  });

  it('returns null for an empty trace', () => {
    expect(normalizeTrace(null)).toBeNull();
    expect(normalizeTrace(undefined)).toBeNull();
  });

  it('surfaces a retrieval error so the sidebar can explain empty retrieval', () => {
    const trace = normalizeTrace({
      query: 'x',
      classification: null as TraceClassification | null,
      retrieved: [],
      rerank: { didRerank: false, reason: '' },
      context: { sources: [], length: 0 },
      error: { message: 'OpenRouter embeddings HTTP 500' },
      timedOut: true,
    });
    expect(trace?.error).toBeDefined();
    expect(trace?.error?.message).toContain('HTTP 500');
    expect(trace?.timedOut).toBe(true);
  });
});

describe('formatScore', () => {
  it('formats a score as a percentage', () => {
    expect(formatScore(0.9)).toBe('90%');
    expect(formatScore(1)).toBe('100%');
  });

  it('returns a placeholder for missing/NaN scores', () => {
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
    expect(formatScore(NaN)).toBe('—');
  });
});