/**
 * Latency helpers — soft timeout + concurrency limiting.
 *
 * Domain 3, Step 3.3. Protects retrieval from one slow dependency dragging the
 * tail (P95/P99) and caps parallelism so the instance does not overload
 * Firestore / OpenRouter.
 */

/**
 * Runs `fn` but resolves with the given `fallback` if it does not settle within
 * `timeoutMs`, OR if `fn` rejects. The underlying task is NOT cancelled (its
 * answer may still be used by the caller) — this is a *soft* timeout: we bound
 * how long we *wait* and we never let a downstream failure (e.g. an OpenRouter
 * embed error) throw out of the retrieval path. A rejection is treated like a
 * timeout: resolve with `{ timedOut: true, value: fallback }`.
 */
export function withSoftTimeout(fn, { timeoutMs, fallback, label = 'async task' } = {}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, value: fallback }), timeoutMs);
    if (timer.unref) timer.unref();
  });
  return Promise.race([
    fn()
      .then((value) => ({ timedOut: false, value }))
      .catch(() => ({ timedOut: true, value: fallback })),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

/**
 * A tiny counting semaphore. Acquires a permit before running `work`; if all
 * permits are taken, the work is queued (backpressure) instead of erroring.
 *
 * @param {number} [maxConcurrent=4]  max simultaneous acquisitions.
 */
export function createSemaphore(maxConcurrent = 4) {
  let active = 0;
  const queue = [];

  async function acquire() {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
  }

  function release() {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  }

  /** Runs `work()` under a permit; returns the work result. */
  async function run(work) {
    await acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }

  return { acquire, release, run, get activeCount() { return active; }, get queueLength() { return queue.length; } };
}