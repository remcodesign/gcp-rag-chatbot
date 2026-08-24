/**
 * State-store shapes (Domain 2).
 *
 * The minimal message-persistence surface the generator needs from the state
 * store (defined structurally so tests pass any matching object).
 */

import type { SourceInfo } from './rag.js';

export interface StateStoreLike {
  persistMessage(
    sessionId: string,
    message: { role: 'assistant'; content: string; sources: SourceInfo[]; complete: boolean },
  ): Promise<unknown>;
}