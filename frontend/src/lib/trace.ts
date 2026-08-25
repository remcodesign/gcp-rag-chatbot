/**
 * RAG trace rendering helpers — POC "inner workings" sidebar.
 *
 * The chatStore retains the backend `trace` payload (see
 * `rag-api/lib/generate/trace.js` for the source shape). This module turns it
 * into display-friendly data for the sidebar: a list of retrieved chunks each
 * tagged with its score and whether it survived into the LLM context window, the
 * rerank decision, the resulting context source order, timings, and the final
 * prompt. It is a pure function of the trace payload so it stays unit-testable.
 */

import type {
  NormalizedTrace,
  RawTrace,
  TraceClassification,
  TraceContext,
  TraceRerank,
  TraceTimings,
} from '../types/trace';

/** Parses the classification reason into a short human label. */
export function describeClassification(classification: TraceClassification | null | undefined): string {
  if (!classification) return 'self-contained (no rewrite)';
  if (classification.rewrite) {
    return `needs rewrite — ${classification.reason || 'ambiguous'}`;
  }
  return classification.reason || 'self-contained (no rewrite)';
}

/**
 * Shapes the backend `trace` payload for rendering.
 *
 * @param trace the raw `trace` SSE payload (may be partial).
 * @returns a normalized object, or null when `trace` is falsy.
 */
export function normalizeTrace(trace: RawTrace | null | undefined): NormalizedTrace | null {
  if (!trace) return null;
  return {
    query: trace.query || '',
    classification: describeClassification(trace.classification),
    retrieved: Array.isArray(trace.retrieved) ? trace.retrieved : [],
    rerank: trace.rerank || ({ didRerank: false, reason: '' } satisfies TraceRerank),
    context: trace.context || ({ sources: [], length: 0 } satisfies TraceContext),
    timings: trace.timings || null,
    timedOut: !!trace.timedOut,
    error: trace.error || null,
    finalPrompt: Array.isArray(trace.finalPrompt) ? trace.finalPrompt.join('\n\n') : '',
  };
}

/**
 * Rounds a score to a percentage or returns a placeholder when absent/NaN.
 *
 * @param score a score from 0..1, or a non-numeric value.
 * @returns a `NN%` string, or the placeholder `—`.
 */
export function formatScore(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return `${(score * 100).toFixed(0)}%`;
}

/** A single timing bar row for the debug sidebar. */
export interface TimingBar {
  label: string;
  ms: number;
  /** Width as a percentage of the largest stage (0..100). */
  pct: number;
}

/**
 * Maps per-stage timings into stacked horizontal bars so the bottleneck is
 * visible at a glance. Widths are proportional to the largest stage.
 *
 * @param timings the trace timings (may be partial / missing `generation`).
 * @returns an ordered list of `{ label, ms, pct }` rows, or `[]` when absent.
 */
export function timingBars(timings: TraceTimings | null | undefined): TimingBar[] {
  if (!timings) return [];
  const rows: Array<{ label: string; ms: number }> = [
    { label: 'Embed', ms: timings.embed },
    { label: 'Retrieve', ms: timings.retrieval },
    { label: 'Rerank', ms: timings.rerank },
    { label: 'Generate', ms: timings.generation ?? 0 },
    { label: 'E2E', ms: timings.e2e ?? timings.total + (timings.generation ?? 0) },
  ];
  const max = Math.max(...rows.map((r) => r.ms), 1);
  return rows.map((r) => ({
    label: r.label,
    ms: r.ms,
    pct: Math.round((r.ms / max) * 100),
  }));
}