import { describe, it, expect } from 'vitest';
import { normalizeTrace, describeClassification, formatScore, timingBars } from '../src/lib/trace';
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

describe('timingBars', () => {
  it('returns one row per stage plus Overhead and E2E, with ms and a width proportional to the largest', () => {
    const bars = timingBars({ embed: 100, retrieval: 50, rerank: 25, generation: 200, total: 375, e2e: 575, overhead: 200 });
    expect(bars.map((b) => b.label)).toEqual(['Embed', 'Retrieve', 'Rerank', 'Generate', 'Overhead', 'E2E']);
    expect(bars.map((b) => b.ms)).toEqual([100, 50, 25, 200, 200, 575]);
    // Largest is E2E (575ms) -> 100%; Generate is ~35%.
    expect(bars.find((b) => b.label === 'E2E')?.pct).toBe(100);
    expect(bars.find((b) => b.label === 'Generate')?.pct).toBe(35);
  });

  it('derives E2E from total + generation when e2e is absent', () => {
    const bars = timingBars({ embed: 100, retrieval: 50, rerank: 25, generation: 200, total: 375 });
    expect(bars.find((b) => b.label === 'E2E')?.ms).toBe(575);
  });

  it('derives Overhead from total minus the stages when overhead is absent', () => {
    const bars = timingBars({ embed: 100, retrieval: 50, rerank: 25, generation: 200, total: 375 });
    expect(bars.find((b) => b.label === 'Overhead')?.ms).toBe(200);
  });

  it('handles a missing generation timing gracefully (0-width bar, no NaN)', () => {
    const bars = timingBars({ embed: 10, retrieval: 20, rerank: 5, total: 35 });
    expect(bars).toHaveLength(6);
    const gen = bars.find((b) => b.label === 'Generate');
    expect(gen?.ms).toBe(0);
    expect(Number.isFinite(gen?.pct)).toBe(true);
    // E2E falls back to total when generation is absent.
    expect(bars.find((b) => b.label === 'E2E')?.ms).toBe(35);
  });

  it('returns an empty list when timings are absent', () => {
    expect(timingBars(null)).toEqual([]);
    expect(timingBars(undefined)).toEqual([]);
  });
});