/**
 * RAG trace types — the frontend "inner workings" sidebar.
 */

import type { Classification, StageTimings } from './rag.js';

/** RAG trace payload sent over SSE to the frontend "inner workings" sidebar. */
export interface TracePayload {
  query: string;
  classification: Classification | null;
  retrieved: TraceHit[];
  rerank: { didRerank: boolean; reason: string };
  context: { sources: Array<{ n: number; id?: string }>; length: number };
  timings: StageTimings | null;
  timedOut: boolean;
  error?: { message: string };
  finalPrompt?: string[];
}

export interface TraceHit {
  id?: string;
  rank: number;
  title: string;
  url: string;
  category?: string | null;
  score: number | null;
  textPreview: string;
  text: string;
  chars: number;
  keptInContext: boolean;
}