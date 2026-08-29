<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { createChatStore, STATUS, MAX_CONVERSATION_TURNS, STAGE_LABELS } from '~/lib/chatStore';
import { openSseStream } from '~/lib/sseTransport';
import { renderAnswer } from '~/lib/citations';
import { resolveApiBase, resolveTraceEnabled } from '~/lib/config';
import { normalizeTrace, timingBars } from '~/lib/trace';
import { useLimits } from '~/composables/useLimits';
import { toChunkModal } from '~/lib/chunkModal';
import { SAMPLE_GROUPS } from '~/lib/sampleQuestions';
import ChatThread from '~/components/ChatThread.vue';
import type { Source } from '~/types/sse';
import type { TraceHit } from '~/types/trace';

// RAG "inner workings" sidebar (POC). The chatStore retains the backend `trace`
// payload when the request asks for it (default on). The sidebar is just a
// closable panel that renders `store.state.trace` — no extra network.
const showTracePanel = ref(false);

// One store per app instance. The transport is the real fetch+ReadableStream
// consumer; the store drives progress, tokens, reconnection and citations.
// The backend origin comes from runtime config (the Nitro BFF proxies to rag-api).
const store = createChatStore(
    {
        send: (params) => openSseStream(params, { baseUrl: resolveApiBase() }),
    },
    {
        trace: resolveTraceEnabled(),
    },
);

const input = ref('');
const sessionId = ref(crypto.randomUUID());

// --- Rate-limit sidebar (POC) -------------------------------------------
// Reactive rate-limit usage for the trace sidebar. Fetches the Nitro BFF's
// /limits/:sessionId endpoint ON DEMAND — after each user message (via
// `refresh()`) and when the panel opens. No polling. This is a POC affordance;
// normally you would not expose rate-limit internals to the client.
const {
    limitInfo,
    ipResetSecs,
    sessionResetSecs,
    refresh: refreshLimits,
} = useLimits(sessionId, showTracePanel);

// The scrollable chat thread container; auto-scrolled to the bottom on new
// content so later answers stay in view.
const threadEl = ref<InstanceType<typeof ChatThread> | null>(null);

/** Smooth-scrolls the chat thread to the bottom (as far as content reaches). */
function scrollThreadToBottom(): void {
    threadEl.value?.scrollToBottom();
}

// Scroll on every new/streaming message and on each finished turn.
watch(
    () => store.state.messages.length,
    () => void nextTick(scrollThreadToBottom),
);
watch(
    () => store.state.answer,
    () => void nextTick(scrollThreadToBottom),
);

const status = computed(() => store.state.status);
const stageLabel = computed(() =>
    store.state.stage ? (STAGE_LABELS[store.state.stage] ?? store.state.stage) : '',
);
const progress = computed(() => store.state.progress);
const error = computed(() => store.state.error);
const errorMessage = computed(() => error.value?.message ?? '');
const errorDetail = computed(() => error.value?.detail ?? null);
const trace = computed(() => normalizeTrace(store.state.trace));

const isStreaming = computed(() => status.value === STATUS.STREAMING);
const isError = computed(() => status.value === STATUS.ERROR);
const isGenerating = computed(() => store.state.stage === 'generating');
const timingRows = computed(() => timingBars(trace.value?.timings ?? null));

/** Completed turns in this conversation (X in "X / 5"). */
const turnCount = computed(() => store.state.turnCount);
/** Whether the backend ended the session at the conversation limit. */
const conversationEnded = computed(() => store.state.conversationEnded);
/** Whether the user can still ask a question (below the cap and not ended). */
const canAsk = computed(() => !conversationEnded.value && turnCount.value < MAX_CONVERSATION_TURNS);

/** The WhatsApp-style transcript (my right bubbles + assistant full-width). */
const transcript = computed(() => store.state.messages);

/** The assistant answer currently streaming, rendered live below the transcript. */
const liveAnswer = computed(() => (isStreaming.value ? store.state.answer : ''));
/** Rendered HTML for the live streaming answer. */
const liveAnswerHtml = computed(() =>
    liveAnswer.value.trim() ? renderMessageHtml(liveAnswer.value, 'assistant') : '',
);

/** Renders one message body (markdown for assistant, plain for user). */
function renderMessageHtml(content: string, role: 'user' | 'assistant'): string {
    return role === 'assistant' ? renderAnswer(content) : content;
}

/** Whether any token-usage / token-speed data is available to render. */
const hasUsage = computed(() => {
    const t = trace.value;
    if (!t) return false;
    return t.usage != null || t.ttftMs != null || t.tokensPerSecond != null;
});

// Extracts a human-readable string from the backend's normalized error detail
// (shape: { message?, statusCode?, retryable? }). Returns '' when there is none.
function describeDetail(detail: unknown): string {
    if (!detail || typeof detail !== 'object') return '';
    const d = detail as { message?: unknown; statusCode?: unknown };
    const parts: string[] = [];
    if (typeof d.statusCode === 'number') parts.push(`HTTP ${d.statusCode}`);
    if (typeof d.message === 'string' && d.message) parts.push(d.message);
    return parts.join(' — ');
}
const errorDetailText = computed(() => describeDetail(errorDetail.value));

// --- Timings modal (POC) ------------------------------------------------
// A button on the "Timings" title opens a modal with two horizontal bars:
// the E2E total on top, and below it the per-stage timings stacked so they
// (ideally) sum to E2E. Same bar width; the stack visually "fills" E2E.
const showTimingsModal = ref(false);

// --- Chunk modal (POC) ------------------------------------------------
// Opening a source chip / trace hit shows the chunk text in a modal instead of
// navigating to a new page. `modal` holds the currently selected chunk.
const modal = ref<ReturnType<typeof toChunkModal>>(null);
function openChunk(chunk: Source | TraceHit): void {
    modal.value = toChunkModal(chunk);
}
function closeChunk(): void {
    modal.value = null;
}

// --- Sample questions modal (POC) ---------------------------------------
// A "+" icon to the left of the input opens a grouped picker of sample
// questions (one group per corpus folder). Picking one sends it immediately.
const showSamplesModal = ref(false);
const sampleGroups = SAMPLE_GROUPS;
function pickSample(text: string): void {
    showSamplesModal.value = false;
    if (!text.trim() || isStreaming.value) return;
    input.value = '';
    void store.sendMessage({ sessionId: sessionId.value, query: text.trim() });
    void refreshLimits();
}

// --- Chat input / submit / retry / new session --------------------------
async function submit(): Promise<void> {
    const q = input.value.trim();
    if (!q || isStreaming.value) return;
    input.value = '';
    await store.sendMessage({ sessionId: sessionId.value, query: q });
    void refreshLimits();
}

function retry(): void {
    store.retry();
}

function newSession(): void {
    store.reset();
    sessionId.value = crypto.randomUUID();
}
</script>

<template>
    <main
        class="mx-auto flex h-screen w-full items-stretch gap-4 box-border p-6"
        style="max-width: 1100px"
    >
        <!-- Chat column -->
        <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4">
            <ChatHeader
                :turn-count="turnCount"
                :can-ask="canAsk"
                :trace-open="showTracePanel"
                :streaming="isStreaming"
                @toggle-trace="showTracePanel = !showTracePanel"
                @new-session="newSession"
            />

            <!-- Progress indicator (Step 6.2) -->
            <ProgressBar
                v-if="isStreaming"
                :stage-label="stageLabel"
                :progress="progress"
                :generating="isGenerating"
            />

            <!-- Conversation limit banner (Domain 10) -->
            <ConversationBanner v-if="conversationEnded" @new-session="newSession" />

            <!-- Error banner (Step 6.1 non-happy) -->
            <ErrorBanner
                v-if="isError"
                :message="errorMessage"
                :detail="errorDetailText"
                @retry="retry"
            />

            <ChatThread
                ref="threadEl"
                :transcript="transcript"
                :live-answer-html="liveAnswerHtml"
                @open-chunk="openChunk"
            />

            <ChatInput
                v-model="input"
                :streaming="isStreaming"
                :can-ask="canAsk"
                @submit="submit"
                @open-samples="showSamplesModal = true"
            />
        </div>

        <Transition name="drawer">
            <TraceSidebar
                v-if="showTracePanel"
                :trace="trace"
                :can-ask="canAsk"
                :turn-count="turnCount"
                :conversation-ended="conversationEnded"
                :timing-rows="timingRows"
                :has-usage="hasUsage"
                :limit-info="limitInfo"
                :ip-reset-secs="ipResetSecs"
                :session-reset-secs="sessionResetSecs"
                @close="showTracePanel = false"
                @open-chunk="openChunk"
                @open-timings="showTimingsModal = true"
            />
        </Transition>

        <!-- Chunk modal (POC): shows the full source chunk when a chip/hit is clicked -->
        <ChunkModal :chunk="modal" @close="closeChunk" />

        <!-- Timings modal (POC): vertical bar graph of the per-stage timings -->
        <TimingsModal
            :show="showTimingsModal"
            :timing-rows="timingRows"
            @close="showTimingsModal = false"
        />

        <!-- Sample questions modal (POC): grouped quick-starts from the corpus -->
        <SampleQuestionsModal
            :show="showSamplesModal"
            :groups="sampleGroups"
            @close="showSamplesModal = false"
            @pick="pickSample"
        />
    </main>
</template>