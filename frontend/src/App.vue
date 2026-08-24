<script setup lang="ts">
import { ref, computed } from 'vue';
import { createChatStore, STATUS } from './lib/chatStore';
import { STAGE_LABELS } from './lib/chatStore';
import { openSseStream } from './lib/sseTransport';
import { renderAnswer, buildSourceChips } from './lib/citations';
import { resolveApiBase, resolveTraceEnabled } from './lib/config';
import { normalizeTrace, formatScore } from './lib/trace';
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

const status = computed(() => store.state.status);
const stageLabel = computed(() =>
  store.state.stage ? STAGE_LABELS[store.state.stage] ?? store.state.stage : ''
);
const progress = computed(() => store.state.progress);
const answerHtml = computed(() => renderAnswer(store.state.answer));
const chips = computed(() => buildSourceChips(store.state.sources));
const error = computed(() => store.state.error);
const trace = computed(() => normalizeTrace(store.state.trace));

const isStreaming = computed(() => status.value === STATUS.STREAMING);
const isError = computed(() => status.value === STATUS.ERROR);

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
          <button
            class="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 text-[color:var(--text)]"
            @click="showTracePanel = !showTracePanel"
            :aria-expanded="showTracePanel"
          >
            <span class="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--accent)] align-middle" aria-hidden="true"></span>
            {{ showTracePanel ? 'Hide RAG trace' : 'RAG trace' }}
          </button>
          <button
            class="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 text-[color:var(--text)] disabled:cursor-default disabled:opacity-50"
            @click="newSession"
            :disabled="isStreaming"
          >New session</button>
        </div>
      </header>

      <!-- Progress indicator (Step 6.2) -->
      <div v-if="isStreaming" class="flex items-center gap-3 text-sm text-[color:var(--muted)]" role="status" aria-live="polite">
        <span>{{ stageLabel }}</span>
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
          <span
            class="block h-full bg-[var(--accent)] transition-[width] duration-300"
            :style="{ width: progress + '%' }"
          ></span>
        </span>
      </div>

      <!-- Error banner (Step 6.1 non-happy) -->
      <div v-if="isError" class="flex items-center justify-between gap-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-[color:var(--danger)]" role="alert">
        <p class="m-0">{{ error }}</p>
        <button
          class="cursor-pointer rounded-lg bg-[var(--danger)] px-3 py-1.5 text-white"
          @click="retry"
        >Retry</button>
      </div>

      <section class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div v-if="!store.state.answer && !isStreaming" class="text-[color:var(--muted)]">
          Ask about returns, warranty, sizing, or product setup.
        </div>

        <!-- Streamed answer with inline citations (Step 6.1 + 6.4) -->
        <div v-if="store.state.answer" class="answer leading-normal" v-html="answerHtml"></div>

        <!-- Source chips (Step 6.4) — click opens the chunk in a modal -->
        <div v-if="chips.length" class="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
          <span class="text-[13px] text-[color:var(--muted)]">Sources</span>
          <button
            v-for="c in chips"
            :key="c.n"
            class="cursor-pointer rounded-full border border-transparent bg-[var(--accent-soft)] px-3 py-1 text-[13px] text-[color:var(--accent)] hover:underline"
            type="button"
            :title="c.title"
            @click="openChunk(c)"
          >[Source {{ c.n }}] {{ c.title }}</button>
        </div>
      </section>

      <form class="flex flex-none gap-2" @submit.prevent="submit">
        <input
          v-model="input"
          type="text"
          placeholder="Ask a question…"
          :disabled="isStreaming"
          autocomplete="off"
          class="flex-1 rounded-[10px] border border-[var(--border)] px-3.5 py-3 text-[15px]"
        />
        <button
          type="submit"
          class="cursor-pointer rounded-[10px] bg-[var(--accent)] px-5 text-white disabled:cursor-default disabled:opacity-50"
          :disabled="isStreaming || !input.trim()"
        >Send</button>
      </form>
    </div>

    <Transition name="drawer">
      <aside
        v-if="showTracePanel"
        class="trace-panel fixed bottom-[84px] right-0 top-0 z-30 flex w-[min(380px,92vw)] flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-[_-6px_0_24px_rgba(0,0,0,0.12)] lg:static lg:h-full lg:w-[340px] lg:shrink-0 lg:rounded-xl lg:border lg:bg-[var(--panel)] lg:shadow-none"
        aria-label="RAG trace details"
      >
        <div class="flex flex-none items-center justify-between border-b border-[var(--border)] px-4 py-3.5">
          <h2 class="m-0 text-[15px]">RAG trace</h2>
          <button
            class="cursor-pointer border-none bg-transparent text-[22px] leading-none text-[color:var(--muted)] hover:text-[color:var(--text)]"
            @click="showTracePanel = false"
            aria-label="Close RAG trace"
          >×</button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <p v-if="!trace" class="text-[14px] text-[color:var(--muted)]">
            No RAG trace yet — ask a question to see retrieval, rerank, context and the final prompt.
          </p>

          <template v-else>
            <section v-if="trace.error" class="mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[color:var(--danger)]" role="alert">
              Retrieval failed — answering without context. {{ trace.error.message }}
            </section>

            <div class="mb-4">
              <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-[color:var(--muted)]">Query</h3>
              <p class="m-0 mb-1 text-[14px] font-semibold">{{ trace.query }}</p>
              <p class="my-0.5 text-[12px] text-[color:var(--muted)]">Classification: {{ trace.classification }}</p>
            </div>

            <div class="mb-4">
              <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-[color:var(--muted)]">Retrieval ({{ trace.retrieved.length }})</h3>
              <ul class="m-0 flex list-none flex-col gap-2 p-0">
                <li
                  v-for="c in trace.retrieved"
                  :key="c.id"
                  class="rounded-lg border border-[var(--border)] px-2.5 py-2"
                  :class="{ 'opacity-55': !c.keptInContext }"
                >
                  <div class="flex items-center gap-2">
                    <span class="rounded bg-[var(--accent-soft)] px-1.5 text-[11px] font-bold text-[color:var(--accent)]">#{{ c.rank }}</span>
                    <button
                      class="min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-left text-[13px] font-semibold text-[color:var(--text)] hover:text-[color:var(--accent)] hover:underline"
                      type="button"
                      @click="openChunk(c)"
                    >{{ c.title }}</button>
                    <span class="text-[12px] font-semibold text-[color:var(--muted)]">{{ formatScore(c.score) }}</span>
                  </div>
                  <div class="my-0.5 text-[11px] text-[color:var(--muted)]">
                    {{ c.chars }} chars · {{ c.keptInContext ? 'in context' : 'dropped' }}
                  </div>
                  <p class="m-0 mt-1 text-[12px] leading-[1.45] whitespace-pre-wrap text-[#3b4757]">{{ c.textPreview }}</p>
                </li>
              </ul>
            </div>

            <div class="mb-4">
              <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-[color:var(--muted)]">Rerank</h3>
              <p class="my-0.5 text-[12px] text-[color:var(--muted)]">
                {{ trace.rerank.didRerank ? 'Reranked' : 'Skipped rerank' }} — {{ trace.rerank.reason }}
              </p>
              <p v-if="trace.timings" class="my-0.5 text-[12px] text-[color:var(--muted)]">
                Embed {{ trace.timings.embed }}ms · Retrieve {{ trace.timings.retrieval }}ms ·
                Rerank {{ trace.timings.rerank }}ms
              </p>
            </div>

            <div class="mb-4">
              <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-[color:var(--muted)]">Context passed to LLM ({{ trace.context.sources.length }})</h3>
              <ol class="m-0 pl-4 text-[12px] text-[color:var(--muted)]">
                <li v-for="s in trace.context.sources" :key="s.id" class="my-0.5">{{ s.id }}</li>
              </ol>
            </div>

            <div v-if="trace.finalPrompt" class="mb-4">
              <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-[color:var(--muted)]">Final prompt</h3>
              <pre class="m-0 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2.5 text-[11px] text-[color:var(--text)]">{{ trace.finalPrompt }}</pre>
            </div>
          </template>
        </div>
      </aside>
    </Transition>

    <!-- Chunk modal (POC): shows the full source chunk when a chip/hit is clicked -->
    <Teleport to="body">
      <div
        v-if="modal"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-6"
        @click.self="closeChunk"
        role="dialog"
        aria-modal="true"
        aria-label="Source chunk"
      >
        <div class="flex max-h-[82vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-xl bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
          <div class="flex flex-none items-center justify-between border-b border-[var(--border)] px-4.5 py-3.5">
            <h2 class="m-0 text-[16px] font-bold">{{ modal.title }}</h2>
            <button
              class="cursor-pointer border-none bg-transparent text-2xl leading-none text-[color:var(--muted)] hover:text-[color:var(--text)]"
              type="button"
              @click="closeChunk"
              aria-label="Close"
            >×</button>
          </div>
          <div class="modal-body overflow-y-auto p-4 px-4.5">
            <p class="my-0 mb-3 break-all text-[12px] text-[color:var(--muted)]">
              <span v-if="modal.score != null">score {{ formatScore(modal.score) }} · </span>
              <code class="rounded bg-[var(--accent-soft)] px-1">{{ modal.id }}</code>
              <template v-if="modal.url && modal.url !== '#'">
                · <a class="text-[color:var(--accent)]" :href="modal.url" target="_blank" rel="noopener">open page</a>
              </template>
            </p>
            <div class="answer leading-normal" v-html="modalHtml"></div>
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
.answer { line-height: 1.6; }
.answer :deep(h1), .answer :deep(h2), .answer :deep(h3), .answer :deep(h4) {
  font-weight: 700;
  line-height: 1.3;
  margin: 1.1em 0 0.45em;
}
.answer :deep(h1) { font-size: 1.35em; }
.answer :deep(h2) { font-size: 1.2em; }
.answer :deep(h3) { font-size: 1.08em; }
.answer :deep(h4) { font-size: 1em; }
.answer :deep(p) { margin: 0 0 0.75em; }
.answer :deep(ul), .answer :deep(ol) { margin: 0.5em 0 0.9em; padding-left: 1.5em; }
.answer :deep(li) { margin: 0.2em 0; }
.answer :deep(strong) { font-weight: 700; }
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
.answer :deep(a) { color: var(--accent); }

/* Citation chips inserted by renderAnswer into the marked-up answer. */
.answer :deep(.citation) {
  display: inline-block;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 6px;
  padding: 0 6px;
  font-size: 0.85em;
  font-weight: 600;
}

/* Modal body padding-below so the content isn't flush against the bottom. */
.modal-body { padding-bottom: 1.5rem; }

/* Drawer slide-in/out transition (used around the trace <aside>). */
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); opacity: 0; }

/* On large screens the trace panel becomes a static sidebar (no transition). */
@media (min-width: 1024px) {
  .drawer-enter-active, .drawer-leave-active { transition: none; }
  .drawer-enter-from, .drawer-leave-to { transform: none; opacity: 1; }
}
</style>