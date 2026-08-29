/**
 * useLimits — reactive rate-limit info for the POC sidebar.
 *
 * Encapsulates the state + logic for showing the BFF's rate-limit usage
 * (client IP + session windows) in the trace sidebar. It fetches the BFF's
 * `/limits/:sessionId` endpoint ON DEMAND — after each user message (the only
 * time the limit changes) and when the panel opens. No polling.
 *
 * This is a POC affordance; normally you would not expose rate-limit internals
 * to the client.
 */

import { ref, computed, watch, type Ref } from 'vue';
import { fetchLimits, secondsUntilReset, type LimitInfo } from '~/lib/limits';

export interface UseLimits {
    /** Current limit usage, or null before the first fetch. */
    limitInfo: Ref<LimitInfo | null>;
    /** Seconds until the IP window resets. */
    ipResetSecs: Ref<number>;
    /** Seconds until the session window resets. */
    sessionResetSecs: Ref<number>;
    /** Re-fetches the limit usage for the current session. */
    refresh: () => Promise<void>;
}

/**
 * Creates the reactive rate-limit state for a session. Pass the session id and
 * a ref to the trace-panel open state; the composable fetches when the panel
 * opens and exposes `refresh()` to call after each user message.
 */
export function useLimits(sessionId: Ref<string>, tracePanelOpen: Ref<boolean>): UseLimits {
    const limitInfo = ref<LimitInfo | null>(null);
    const nowMs = ref(Date.now());

    async function refresh(): Promise<void> {
        limitInfo.value = await fetchLimits(sessionId.value);
        nowMs.value = Date.now();
    }

    // Fetch once when the panel opens (shows the current state immediately).
    watch(tracePanelOpen, (open) => {
        if (open) void refresh();
    });

    const ipResetSecs = computed(() =>
        limitInfo.value ? secondsUntilReset(limitInfo.value.ip.resetAt, nowMs.value) : 0,
    );
    const sessionResetSecs = computed(() =>
        limitInfo.value ? secondsUntilReset(limitInfo.value.session.resetAt, nowMs.value) : 0,
    );

    return { limitInfo, ipResetSecs, sessionResetSecs, refresh };
}
