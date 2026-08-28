/**
 * Extracts the text delta from an OpenRouter streaming chunk.
 *
 * Domain 5. OpenRouter (OpenAI-compatible) chunks nest content under
 * `choices[0].delta.content`. This reads a dotted path with numeric + string
 * segments so model overrides that relocate the delta still work.
 */

import type { ChatStreamChunk } from '../types/chat.js';

interface ReadDeltaOptions {
    /** Dot path to the delta content (default "choices.0.delta.content"). */
    delta?: string;
}

export function readDelta(
    chunk: ChatStreamChunk | null | undefined,
    { delta = 'choices.0.delta.content' }: ReadDeltaOptions = {},
): string {
    const parts = delta.split('.');
    let cur: unknown = chunk;
    for (let i = 0; cur != null && i < parts.length; i += 1) {
        const raw = parts[i] as string | undefined;
        if (raw === undefined) break;
        const key = Number.isInteger(Number(raw)) ? Number(raw) : raw;
        cur = (cur as Record<string | number, unknown>)[key];
    }
    return typeof cur === 'string' ? cur : '';
}
