<script setup lang="ts">
    import { ref, computed, watch, nextTick } from 'vue';
    import { createChatStore, STATUS, MAX_CONVERSATION_TURNS } from './lib/chatStore';
    import { STAGE_LABELS } from './lib/chatStore';
    import { openSseStream } from './lib/sseTransport';
    import { renderAnswer } from './lib/citations';
    import { resolveApiBase, resolveTraceEnabled } from './lib/config';
    import { normalizeTrace, formatScore, timingBars } from './lib/trace';
    import { SAMPLE_GROUPS } from './lib/sampleQuestions';
    import TraceSidebar from './components/TraceSidebar.vue';
    import TimingsModal from './components/TimingsModal.vue';
    import type { Source } from './types/sse';
    import type { TraceHit } from './types/trace';

    // RAG "inner workings" sidebar (POC). The chatStore retains the backend `trace`
    // payload when the request asks for it (default on). The sidebar is just a
    // closable panel that renders `store.state.trace` — no extra network.
    const showTracePanel = ref(false);

    // One store per app instance. The transport is the real fetch+ReadableStream
    // consumer; the store drives progress, tokens, reconnection and citations.
    // The backend origin comes from runtime config (separate Cloud Run service).
    const store = createChatStore({
        send: (params) => openSseStream(params, { baseUrl: resolveApiBase() }),
    }, {
        trace: resolveTraceEnabled(),
    });

    const input = ref('');
    const sessionId = ref(crypto.randomUUID());

    // The scrollable chat thread container; auto-scrolled to the bottom on new
    // content so later answers stay in view.
    const threadEl = ref<HTMLElement | null>(null);

    /** Smooth-scrolls the chat thread to the bottom (as far as content reaches). */
    function scrollThreadToBottom(): void {
        const el = threadEl.value;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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
        store.state.stage ? STAGE_LABELS[store.state.stage] ?? store.state.stage : ''
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
    const canAsk = computed(() =>
        !conversationEnded.value && turnCount.value < MAX_CONVERSATION_TURNS,
    );

    /** The WhatsApp-style transcript (my right bubbles + assistant full-width). */
    const transcript = computed(() => store.state.messages);

    /** The assistant answer currently streaming, rendered live below the transcript. */
    const liveAnswer = computed(() =>
        isStreaming.value ? store.state.answer : '',
    );
    /** Rendered HTML for the live streaming answer. */
    const liveAnswerHtml = computed(() =>
        liveAnswer.value.trim()
            ? renderMessageHtml(liveAnswer.value, 'assistant')
            : '',
    );

    /** Formats an epoch-ms timestamp as `HH:MM` (local). */
    function formatTime(ts: number): string {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    /** Renders one message body (markdown for assistant, plain for user). */
    function renderMessageHtml(content: string, role: 'user' | 'assistant'): string {
        return role === 'assistant' ? renderAnswer(content) : content;
    }

    /** Whether any token-usage / token-speed data is available to render. */
    const hasUsage = computed(() => {
        const t = trace.value;
        if (!t) return false;
        return (
            t.usage != null ||
            t.ttftMs != null ||
            t.tokensPerSecond != null
        );
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
    interface ChunkModal {
        title: string;
        url: string;
        id: string;
        text: string;
        score?: number | null;
    }
    const modal = ref<ChunkModal | null>(null); // { title, url, id, text, score? }
    function openChunk(chunk: Source | TraceHit): void {
        if (!chunk) return;
        const id = 'id' in chunk ? chunk.id : '';
        modal.value = {
            title: chunk.title ?? '',
            url: chunk.url ?? '#',
            id,
            text: 'text' in chunk && typeof chunk.text === 'string' ? chunk.text : '',
            score: 'score' in chunk ? chunk.score : null,
        };
    }
    function closeChunk(): void {
        modal.value = null;
    }
    const modalHtml = computed(() => (modal.value ? renderAnswer(modal.value.text) : ''));

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
    }

    async function submit(): Promise<void> {
        const q = input.value.trim();
        if (!q || isStreaming.value) return;
        input.value = '';
        await store.sendMessage({ sessionId: sessionId.value, query: q });
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
    <main class="mx-auto flex h-screen w-full items-stretch gap-4 box-border p-6" style="max-width: 1100px">
        <!-- Chat column -->
        <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4">
            <header class="flex items-center justify-between">
                <h1 class="m-0 text-xl">Northwind Outfitters — Support Chat</h1>
                <div class="flex items-center gap-2">
                    <span class="rounded-full border border-(--border) px-3 py-1.5 text-[13px]"
                        :class="canAsk ? 'text-(--muted)' : 'text-(--danger)'"
                        :title="'Vragen in dit gesprek: ' + turnCount + ' van ' + MAX_CONVERSATION_TURNS">{{ turnCount
                        }} / {{
                            MAX_CONVERSATION_TURNS }}</span>
                    <button class="cursor-pointer rounded-lg border border-(--border) px-3 py-1.5 text-(--text)"
                        @click="showTracePanel = !showTracePanel" :aria-expanded="showTracePanel">
                        <span class="mr-1.5 inline-block h-2 w-2 rounded-full bg-(--accent) align-middle"
                            aria-hidden="true"></span>
                        {{ showTracePanel ? 'Hide RAG trace' : 'RAG trace' }}
                    </button>
                    <button
                        class="cursor-pointer rounded-lg border border-(--border) px-3 py-1.5 text-(--text) disabled:cursor-default disabled:opacity-50"
                        @click="newSession" :disabled="isStreaming">New session</button>
                </div>
            </header>

            <!-- Progress indicator (Step 6.2) -->
            <div v-if="isStreaming" class="flex items-center gap-3 text-sm text-(--muted)" role="status"
                aria-live="polite">
                <span class="flex items-center gap-1.5">
                    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
                    {{ stageLabel }}
                </span>
                <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-(--border)">
                    <span class="block h-full bg-(--accent) transition-[width] duration-300"
                        :class="{ 'bar-breathing': isGenerating }"
                        :style="isGenerating ? undefined : { width: progress + '%' }"></span>
                </span>
            </div>

            <!-- Conversation limit banner (Domain 10) -->
            <div v-if="conversationEnded"
                class="flex items-center justify-between gap-3 rounded-lg border border-(--accent) bg-(--accent-soft) px-4 py-3 text-(--text)">
                <p class="m-0 text-[13px]">
                    Dit gesprek is afgelopen. Start een <button
                        class="cursor-pointer border-none bg-transparent p-0 text-[13px] font-semibold text-(--accent) hover:underline"
                        type="button" @click="newSession">nieuw gesprek</button> om verder te gaan.
                </p>
            </div>

            <!-- Error banner (Step 6.1 non-happy) -->
            <div v-if="isError"
                class="flex items-center justify-between gap-3 rounded-lg border border-(--danger) bg-(--danger-soft) px-4 py-3 text-(--danger)"
                role="alert">
                <div class="min-w-0">
                    <p class="m-0 font-semibold">{{ errorMessage }}</p>
                    <p v-if="errorDetailText" class="m-0 mt-0.5 text-[12px] break-words opacity-80">{{ errorDetailText
                    }}</p>
                </div>
                <button class="shrink-0 cursor-pointer rounded-lg bg-(--danger) px-3 py-1.5 text-white"
                    @click="retry">Retry</button>
            </div>

            <section ref="threadEl"
                class="no-scrollbar min-h-0 flex-1 overflow-y-auto rounded-xl border border-(--border) bg-(--panel) p-5">
                <div v-if="transcript.length === 0" class="text-(--muted)">
                    Ask about returns, warranty, sizing, or product setup.
                </div>

                <!-- WhatsApp-style transcript: my messages as right bubbles, the
             assistant full-width without a bubble. -->
                <div v-else class="flex flex-col gap-4">
                    <div v-for="(m, i) in transcript" :key="i" class="flex flex-col"
                        :class="m.role === 'user' ? 'items-end' : 'items-start'">
                        <!-- Small line with the sender + time, above each message -->
                        <div class="mb-1 flex items-center gap-1.5 text-[11px] text-(--muted)"
                            :class="m.role === 'user' ? 'flex-row-reverse' : 'flex-row'">
                            <span class="font-semibold">{{ m.role === 'user' ? 'Jij' : 'Northwind Assistent' }}</span>
                            <span aria-hidden="true">·</span>
                            <span>{{ formatTime(m.createdAt) }}</span>
                        </div>

                        <!-- User: right-aligned bubble. Assistant: full-width, no bubble. -->
                        <div v-if="m.role === 'user'"
                            class="max-w-[80%] rounded-2xl rounded-br-md bg-(--accent) px-3.5 py-2.5 text-white shadow-sm">
                            <p class="m-0 whitespace-pre-wrap text-[14px] leading-[1.45]">{{ m.content }}</p>
                        </div>

                        <div v-else class="w-full">
                            <div class="answer leading-normal text-(--text)"
                                v-html="renderMessageHtml(m.content, 'assistant')"></div>
                            <!-- Source chips for the assistant reply -->
                            <div v-if="m.sources && m.sources.length"
                                class="mt-3 flex flex-wrap items-center gap-2 border-t border-(--border) pt-3">
                                <span class="text-[13px] text-(--muted)">Sources</span>
                                <button v-for="c in m.sources" :key="c.n"
                                    class="cursor-pointer rounded-full border border-transparent bg-(--accent-soft) px-3 py-1 text-[13px] text-(--accent) hover:underline"
                                    type="button" :title="c.title" @click="openChunk(c)">[Source {{ c.n }}] {{ c.title
                                    }}</button>
                            </div>
                        </div>
                    </div>

                    <!-- Live streaming assistant answer: shown as a full-width bubble
               while tokens stream in, folded into the transcript on `done`. -->
                    <div v-if="liveAnswerHtml" class="flex flex-col items-start">
                        <div class="mb-1 flex items-center gap-1.5 text-[11px] text-(--muted)">
                            <span class="font-semibold">Northwind Assistent</span>
                            <span aria-hidden="true">·</span>
                            <span>{{ formatTime(Date.now()) }}</span>
                        </div>
                        <div class="answer w-full leading-normal text-(--text)" v-html="liveAnswerHtml"></div>
                    </div>
                </div>
            </section>

            <form class="flex flex-none gap-2" @submit.prevent="submit">
                <button type="button"
                    class="shrink-0 cursor-pointer rounded-[10px] border border-(--border) bg-(--panel) px-3 text-[20px] leading-none text-(--muted) hover:text-(--accent) disabled:cursor-default disabled:opacity-50"
                    :disabled="isStreaming" :title="'Sample questions'" aria-label="Sample questions"
                    @click="showSamplesModal = true">+</button>
                <input v-model="input" type="text"
                    :placeholder="canAsk ? 'Ask a question…' : 'Start een nieuw gesprek om verder te vragen'"
                    :disabled="isStreaming || !canAsk" autocomplete="off"
                    class="flex-1 rounded-[10px] border border-(--border) bg-(--panel) px-3.5 py-3 text-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_rgba(16,24,40,0.05)] placeholder:text-(--muted)" />
                <button type="submit"
                    class="cursor-pointer rounded-[10px] bg-(--accent) px-5 text-white disabled:cursor-default disabled:opacity-50"
                    :disabled="isStreaming || !input.trim() || !canAsk">Send</button>
            </form>
        </div>

        <Transition name="drawer">
            <TraceSidebar v-if="showTracePanel" :trace="trace" :can-ask="canAsk" :turn-count="turnCount"
                :conversation-ended="conversationEnded" :timing-rows="timingRows" :has-usage="hasUsage"
                @close="showTracePanel = false" @open-chunk="openChunk" @open-timings="showTimingsModal = true" />
        </Transition>

        <!-- Chunk modal (POC): shows the full source chunk when a chip/hit is clicked -->
        <Teleport to="body">
            <div v-if="modal" class="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-6"
                @click.self="closeChunk" role="dialog" aria-modal="true" aria-label="Source chunk">
                <div
                    class="flex max-h-[82vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-xl bg-(--panel) shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div class="flex flex-none items-center justify-between border-b border-(--border) px-4.5 py-3.5">
                        <h2 class="m-0 text-[16px] font-bold">{{ modal.title }}</h2>
                        <button
                            class="cursor-pointer border-none bg-transparent text-2xl leading-none text-(--muted) hover:text-(--text)"
                            type="button" @click="closeChunk" aria-label="Close">×</button>
                    </div>
                    <div class="modal-body no-scrollbar overflow-y-auto p-4 px-4.5">
                        <p class="my-0 mb-3 break-all text-[12px] text-(--muted)">
                            <span v-if="modal.score != null">score {{ formatScore(modal.score) }} · </span>
                            <code class="rounded bg-(--accent-soft) px-1">{{ modal.id }}</code>

                            <!-- <template v-if="modal.url && modal.url !== '#'">
                · <a class="text-(--accent)" :href="modal.url" target="_blank" rel="noopener">open page</a>
              </template> -->

                        </p>
                        <div class="answer leading-normal" v-html="modalHtml"></div>
                    </div>
                </div>
            </div>
        </Teleport>




        <!-- Timings modal (POC): vertical bar graph of the per-stage timings -->
        <TimingsModal :show="showTimingsModal" :timing-rows="timingRows" @close="showTimingsModal = false" />

        <!-- Sample questions modal (POC): grouped quick-starts from the corpus -->
        <Teleport to="body">
            <div v-if="showSamplesModal"
                class="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-6"
                @click.self="showSamplesModal = false" role="dialog" aria-modal="true" aria-label="Sample questions">
                <div
                    class="flex max-h-[82vh] w-[min(880px,100%)] flex-col overflow-hidden rounded-xl bg-(--panel) shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div class="flex flex-none items-center justify-between border-b border-(--border) px-4.5 py-3.5">
                        <h2 class="m-0 text-[16px] font-bold">Sample questions</h2>
                        <button
                            class="cursor-pointer border-none bg-transparent text-2xl leading-none text-(--muted) hover:text-(--text)"
                            type="button" @click="showSamplesModal = false" aria-label="Close">×</button>
                    </div>
                    <div class="no-scrollbar overflow-y-auto p-5">
                        <p class="m-0 mb-4 text-[12px] text-(--muted)">
                            Pick a question to get started. Select one and it sends immediately.
                        </p>
                        <div class="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                            <div v-for="group in sampleGroups" :key="group.folder">
                                <h3 class="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-(--muted)">
                                    {{ group.label }}
                                </h3>
                                <div class="flex flex-col gap-1.5">
                                    <button v-for="q in group.questions" :key="q.text" type="button"
                                        class="cursor-pointer rounded-lg border border-(--border) bg-(--bg) px-3 py-2 text-left text-[13px] text-(--text) transition-colors hover:border-(--accent) hover:text-(--accent)"
                                        @click="pickSample(q.text)">{{ q.text }}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Teleport>
    </main>
</template>

<!--
  Minimal scoped CSS for the *dynamically-rendered* markdown output (`.answer`
  is bound via v-html, so Tailwind utilities can't reach into the generated
  HTML). Everything else on the page is styled with Tailwind utilities directly
  in the template above. The `:root` theme tokens (--accent etc.) come from
  src/style.css @theme/@import, and are referenced here via var().
-->
<style scoped>

    /* Rendered answer typography (markdown converted by lib/markdown.ts and
   injected via v-html). Because the HTML is generated at runtime it carries no
   `data-v` scoping attribute, so we use `:deep()` for every descendant —
   otherwise scoped CSS (`.answer h3 -> .answer h3[data-v]`) never matches the
   injected elements. This is what "broke" the bold markdown headings. */
    .answer {
        line-height: 1.6;
    }

    .answer :deep(h1),
    .answer :deep(h2),
    .answer :deep(h3),
    .answer :deep(h4) {
        font-weight: 700;
        line-height: 1.3;
        margin: 1.1em 0 0.45em;
    }

    .answer :deep(h1) {
        font-size: 1.35em;
    }

    .answer :deep(h2) {
        font-size: 1.2em;
    }

    .answer :deep(h3) {
        font-size: 1.08em;
    }

    .answer :deep(h4) {
        font-size: 1em;
    }

    .answer :deep(p) {
        margin: 0 0 0.75em;
    }

    /* Tailwind v4 preflight removes list markers (list-style: none), so bullets/
   numbers are restored explicitly here — the generator (marked) emits real
   <ul>/<ol>/<li>, and this scoped :deep() re-establishes the markers. */
    .answer :deep(ul),
    .answer :deep(ol) {
        margin: 0.5em 0 0.9em;
        padding-left: 1.6em;
    }

    .answer :deep(ul) {
        list-style: disc;
    }

    .answer :deep(ol) {
        list-style: decimal;
    }

    .answer :deep(ul ul) {
        list-style: circle;
    }

    .answer :deep(ol ol) {
        list-style: lower-alpha;
    }

    .answer :deep(li) {
        margin: 0.2em 0;
    }

    .answer :deep(li > ul),
    .answer :deep(li > ol) {
        margin: 0.15em 0;
    }

    /* Lists nested inside table <td> cells render just like any other list. */
    .answer :deep(td ul),
    .answer :deep(td ol) {
        list-style: disc;
        list-style-position: inside;
    }

    .answer :deep(td li > ul),
    .answer :deep(td li > ol) {
        padding-left: 1.1em;
        list-style-position: outside;
        list-style: circle;
    }

    .answer :deep(td li > ul li) {
        list-style: disc;
    }

    .answer :deep(strong) {
        font-weight: 700;
    }

    .answer :deep(code) {
        background: var(--accent-soft);
        border-radius: 4px;
        padding: 0.1em 0.35em;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.9em;
    }

    .answer :deep(blockquote) {
        margin: 0.6em 0;
        padding-left: 0.9em;
        border-left: 3px solid var(--border);
        color: var(--muted);
    }

    .answer :deep(hr) {
        border: none;
        border-top: 1px solid var(--border);
        margin: 1.6em 0;
    }

    .answer :deep(a) {
        color: var(--accent);
    }

    /* Tables rendered from markdown inside the answer. */
    .answer :deep(table) {
        width: 100%;
        border-collapse: collapse;
        margin: 0.75em 0 1.5em;
        font-size: 0.95em;
    }

    .answer :deep(th),
    .answer :deep(td) {
        border: 1px solid var(--border);
        padding: 0.5em 0.7em;
    }

    .answer :deep(th) {
        text-align: left;
        background: var(--accent-soft);
        font-weight: 600;
    }

    .answer :deep(tr:nth-child(even) td) {
        background: var(--bg);
    }

    /* Citation chips inserted by renderAnswer into the marked-up answer. */
    .answer :deep(.citation) {
        display: inline-block;
        background: transparent;
        color: var(--muted);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 0 5px;
        font-size: 0.8em;
        font-weight: 500;
        vertical-align: baseline;
        line-height: 1.4;
    }

    .answer :deep(.citation:hover) {
        background: var(--accent-soft);
        color: var(--accent);
        border-color: transparent;
        cursor: pointer;
    }

    /* Modal body padding-below so the content isn't flush against the bottom. */
    .modal-body {
        padding-bottom: 1.5rem;
    }

    /* Animated "busy" dots next to the stage label (Problem C). */
    .dots {
        display: inline-flex;
        gap: 3px;
    }

    .dots i {
        width: 5px;
        height: 5px;
        border-radius: 9999px;
        background: var(--accent);
        animation: dot-pulse 1.2s ease-in-out infinite;
    }

    .dots i:nth-child(2) {
        animation-delay: 0.15s;
    }

    .dots i:nth-child(3) {
        animation-delay: 0.3s;
    }

    @keyframes dot-pulse {

        0%,
        80%,
        100% {
            opacity: 0.25;
            transform: translateY(0);
        }

        40% {
            opacity: 1;
            transform: translateY(-2px);
        }
    }

    /* Indeterminate "breathing" bar while tokens are flowing (Problem C). */
    .bar-breathing {
        width: 100%;
        animation: bar-breathe 1.4s ease-in-out infinite;
    }

    @keyframes bar-breathe {

        0%,
        100% {
            opacity: 0.35;
        }

        50% {
            opacity: 1;
        }
    }

    /* Drawer slide-in/out transition (used around the trace <aside>). */
    .drawer-enter-active,
    .drawer-leave-active {
        transition: transform 0.25s ease, opacity 0.25s ease;
    }

    .drawer-enter-from,
    .drawer-leave-to {
        transform: translateX(100%);
        opacity: 0;
    }

    /* On large screens the trace panel becomes a static sidebar (no transition). */
    @media (min-width: 1024px) {

        .drawer-enter-active,
        .drawer-leave-active {
            transition: none;
        }

        .drawer-enter-from,
        .drawer-leave-to {
            transform: none;
            opacity: 1;
        }
    }
</style>

<!--
  Non-scoped so `::-webkit-scrollbar` pseudo-element rules apply to the dynamic
  scroll containers (scoped selectors don't extend into pseudo-elements well).
  Adds the `.no-scrollbar` utility: scrollable, but the scrollbar is invisible
  (Firefox/Safari via `scrollbar-width`/`color`, Chromium via -webkit-*).
-->
<style>
    .no-scrollbar {
        -ms-overflow-style: none;
        /* IE/legacy Edge */
        scrollbar-width: none;
        /* Firefox */
    }

    .no-scrollbar::-webkit-scrollbar {
        width: 0;
        /* Chromium/Safari */
        height: 0;
    }

    .no-scrollbar::-webkit-scrollbar-thumb,
    .no-scrollbar::-webkit-scrollbar-track {
        background: transparent;
    }
</style>