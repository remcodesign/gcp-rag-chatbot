/**
 * Server-Sent Events (SSE) framing helper for the streaming chat endpoint.
 *
 * Domain 5. Writes `id:`/`event:`/`data:` frames to a response sink
 * (`ServerResponse` or a test fake), tracks a monotonically increasing event id,
 * and provides a closed/destroyed guard so no frame is written to a torn-down
 * socket.
 */

export const SSE_EVENT = {
    PROGRESS: 'progress',
    TOKEN: 'token',
    ERROR: 'error',
    DONE: 'done',
    TRACE: 'trace',
} as const;

export interface SseFrameData {
    [key: string]: unknown;
}

/** Minimal response sink the SSE helper writes to (ServerResponse + test fakes). */
export interface SseResponse {
    destroyed: boolean;
    writeHead(statusCode: number, headers: Record<string, string>): unknown;
    write(chunk: string): unknown;
    end(cb?: () => void): unknown;
    end(): unknown;
}

interface SseOptions {
    /** Starts ids at a known value (default 0). */
    idFactory?: () => number;
    /** Extra headers merged into the 200 response head. */
    extraHeaders?: Record<string, string>;
}

export interface Sse {
    send(event: string, data: unknown): number | null;
    sendRaw(str: string): boolean;
    end(): void;
    error(payload: SseFrameData): void;
    readonly nextId: number;
    isClosed(): boolean;
}

export function createSse(res: SseResponse, options: SseOptions = {}): Sse {
    let nextId = options.idFactory ? options.idFactory() : 0;
    let writeHeadDone = false;
    let closed = false;

    function ensureHead(): void {
        if (writeHeadDone) return;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...(options.extraHeaders || {}),
        });
        writeHeadDone = true;
    }

    function isClosed(): boolean {
        if (closed) return true;
        return !!res.destroyed;
    }

    function close(): void {
        if (closed) return;
        closed = true;
        if (typeof res.end === 'function') {
            try {
                res.end();
            } catch {
                // already destroyed
            }
        }
    }

    function send(event: string, data: unknown): number | null {
        if (isClosed()) return null;
        ensureHead();
        const id = nextId;
        nextId += 1;
        const payload = typeof data === 'string' ? data : JSON.stringify(data ?? {});
        const frame = `id: ${id}\nevent: ${event}\ndata: ${payload}\n\n`;
        res.write(frame);
        return id;
    }

    function sendRaw(str: string): boolean {
        if (isClosed()) return false;
        ensureHead();
        res.write(str);
        return true;
    }

    function end(): void {
        close();
    }

    function error(payload: SseFrameData): void {
        send(SSE_EVENT.ERROR, payload);
        close();
    }

    return { send, sendRaw, end, error, get nextId() { return nextId; }, isClosed };
}