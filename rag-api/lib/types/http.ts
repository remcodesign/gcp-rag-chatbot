/**
 * HTTP boundary types for the rag-api service.
 *
 * The SSE request body is the only structured payload the service accepts
 * (`POST /sessions/:id/messages`). Fields are `unknown` and narrowed at the
 * handler so a malformed body degrades to a clear SSE `error` frame instead of
 * a crash.
 */

export interface SseRequestBody {
    query?: unknown;
    question?: unknown;
    options?: Record<string, unknown>;
    trace?: unknown;
}
