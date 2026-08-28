/**
 * Latency helpers — soft timeout + concurrency limiting.
 *
 * Domain 3, Step 3.3. Protects retrieval from one slow dependency dragging
 * the tail (P95/P99) and caps parallelism so the instance does not overload
 * Firestore / OpenRouter.
 */

type TimerHandle = ReturnType<typeof setTimeout> & { unref?: () => void };

interface SoftTimeoutOptions<TValue> {
    /** Soft timeout in ms. */
    timeoutMs?: number;
    /** Fallback value on timeout/rejection. */
    fallback: TValue;
    /** Logging label (default "async task"). */
    label?: string;
}

export interface SoftTimeoutResult<TValue> {
    timedOut: boolean;
    value: TValue;
}

export function withSoftTimeout<TValue>(
    fn: () => Promise<TValue>,
    options: SoftTimeoutOptions<TValue> = { fallback: undefined as TValue },
): Promise<SoftTimeoutResult<TValue>> {
    let timer: TimerHandle;
    const timeout: Promise<SoftTimeoutResult<TValue>> = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true, value: options.fallback }), options.timeoutMs);
        timer.unref?.();
    });
    return Promise.race([
        fn()
            .then((value) => ({ timedOut: false, value }))
            // A rejected wrapped task is treated like a timeout: retrieval must not
            // throw (silent degrade to fallback), per Domain 3 / Gotcha 5.
            .catch(() => ({ timedOut: true, value: options.fallback })),
        timeout,
    ]).finally(() => clearTimeout(timer));
}

type Resolver = () => void;

export interface Semaphore {
    acquire(): Promise<void>;
    release(): void;
    run<TResult>(work: () => Promise<TResult>): Promise<TResult>;
    readonly activeCount: number;
    readonly queueLength: number;
}

export function createSemaphore(maxConcurrent = 4): Semaphore {
    let active = 0;
    const queue: Resolver[] = [];

    async function acquire(): Promise<void> {
        if (active >= maxConcurrent) {
            await new Promise<void>((resolve) => queue.push(resolve));
        }
        active += 1;
    }

    function release(): void {
        active -= 1;
        const next = queue.shift();
        if (next) next();
    }

    async function run<TResult>(work: () => Promise<TResult>): Promise<TResult> {
        await acquire();
        try {
            return await work();
        } finally {
            release();
        }
    }

    return {
        acquire,
        release,
        run,
        get activeCount() {
            return active;
        },
        get queueLength() {
            return queue.length;
        },
    };
}