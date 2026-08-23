<script setup>
import { ref, computed } from 'vue';
import { createChatStore, STAGE_LABELS, STATUS } from './lib/chatStore.js';
import { openSseStream } from './lib/sseTransport.js';
import { renderAnswer, buildSourceChips } from './lib/citations.js';
import { resolveApiBase, resolveTraceEnabled } from './lib/config.js';
import { normalizeTrace, formatScore } from './lib/trace.js';

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
const isDone = computed(() => status.value === STATUS.DONE);
const isError = computed(() => status.value === STATUS.ERROR);

// --- Chunk modal (POC) ------------------------------------------------
// Opening a source chip / trace hit shows the chunk text in a modal instead of
// navigating to a new page. `modal` holds the currently selected chunk.
const modal = ref(null); // { title, url, id, text, score? }
function openChunk(chunk) {
  if (!chunk) return;
  modal.value = { title: chunk.title, url: chunk.url, id: chunk.id, text: chunk.text || '', score: chunk.score };
}
function closeChunk() {
  modal.value = null;
}
const modalHtml = computed(() => (modal.value ? renderAnswer(modal.value.text) : ''));

async function submit() {
  const q = input.value.trim();
  if (!q || isStreaming.value) return;
  input.value = '';
  await store.sendMessage({ sessionId: sessionId.value, query: q });
}

function retry() {
  store.retry();
}

function newSession() {
  store.reset();
  sessionId.value = crypto.randomUUID();
}
</script>

<template>
  <main class="layout" :class="{ 'layout--has-trace': showTracePanel }">
    <!-- Chat column -->
    <div class="layout__main">
      <header class="chat__header">
        <h1>Northwind Outfitters — Support Chat</h1>
        <div class="chat__header-actions">
          <button
            class="chat__new trace-toggle"
            @click="showTracePanel = !showTracePanel"
            :aria-expanded="showTracePanel"
          >
            <span class="trace-toggle__dot" aria-hidden="true"></span>
            {{ showTracePanel ? 'Hide RAG trace' : 'RAG trace' }}
          </button>
          <button class="chat__new" @click="newSession" :disabled="isStreaming">New session</button>
        </div>
      </header>

      <!-- Progress indicator (Step 6.2) -->
      <div v-if="isStreaming" class="progress" role="status" aria-live="polite">
        <span class="progress__label">{{ stageLabel }}</span>
        <span class="progress__bar"><span :style="{ width: progress + '%' }"></span></span>
      </div>

      <!-- Error banner (Step 6.1 non-happy) -->
      <div v-if="isError" class="error-banner" role="alert">
        <p>{{ error }}</p>
        <button @click="retry">Retry</button>
      </div>

      <section class="chat__body">
        <div v-if="!store.state.answer && !isStreaming" class="chat__empty">
          Ask about returns, warranty, sizing, or product setup.
        </div>

        <!-- Streamed answer with inline citations (Step 6.1 + 6.4) -->
        <div v-if="store.state.answer" class="answer" v-html="answerHtml"></div>

        <!-- Source chips (Step 6.4) — click opens the chunk in a modal -->
        <div v-if="chips.length" class="sources">
          <span class="sources__label">Sources</span>
          <button
            v-for="c in chips"
            :key="c.n"
            class="chip"
            type="button"
            :title="c.title"
            @click="openChunk(c)"
          >[Source {{ c.n }}] {{ c.title }}</button>
        </div>
      </section>

      <form class="chat__input" @submit.prevent="submit">
        <input
          v-model="input"
          type="text"
          placeholder="Ask a question…"
          :disabled="isStreaming"
          autocomplete="off"
        />
        <button type="submit" :disabled="isStreaming || !input.trim()">Send</button>
      </form>
    </div>
    <Transition name="drawer">
      <aside
        v-if="showTracePanel"
        class="trace-panel"
        aria-label="RAG trace details"
      >
        <div class="trace-panel__head">
          <h2>RAG trace</h2>
          <button class="trace-panel__close" @click="showTracePanel = false" aria-label="Close RAG trace">×</button>
        </div>
        <div class="trace-panel__scroll">
          <p v-if="!trace" class="trace-panel__empty">
            No RAG trace yet — ask a question to see retrieval, rerank, context and the final prompt.
          </p>

          <template v-else>
        <section v-if="trace.error" class="trace-error" role="alert">
          Retrieval failed — answering without context. {{ trace.error.message }}
        </section>

        <section class="trace-block">
          <h3>Query</h3>
          <p class="trace-query">{{ trace.query }}</p>
          <p class="trace-meta">Classification: {{ trace.classification }}</p>
        </section>

        <section class="trace-block">
          <h3>Retrieval ({{ trace.retrieved.length }})</h3>
              <ul class="trace-chunks">
                <li
                  v-for="c in trace.retrieved"
                  :key="c.id"
                  class="trace-chunk"
                  :class="{ 'is-dropped': !c.keptInContext }"
                >
                  <div class="trace-chunk__row">
                    <span class="trace-chunk__rank">#{{ c.rank }}</span>
                    <button class="trace-chunk__title" type="button" @click="openChunk(c)">{{ c.title }}</button>
                    <span class="trace-chunk__score">{{ formatScore(c.score) }}</span>
                  </div>
                  <div class="trace-chunk__meta">
                    {{ c.chars }} chars · {{ c.keptInContext ? 'in context' : 'dropped' }}
                  </div>
                  <p class="trace-chunk__preview">{{ c.textPreview }}</p>
                </li>
              </ul>
            </section>

            <section class="trace-block">
              <h3>Rerank</h3>
              <p class="trace-meta">
                {{ trace.rerank.didRerank ? 'Reranked' : 'Skipped rerank' }} — {{ trace.rerank.reason }}
              </p>
              <p v-if="trace.timings" class="trace-meta">
                Embed {{ trace.timings.embed }}ms · Retrieve {{ trace.timings.retrieval }}ms ·
                Rerank {{ trace.timings.rerank }}ms
              </p>
            </section>

            <section class="trace-block">
              <h3>Context passed to LLM ({{ trace.context.sources.length }})</h3>
              <ol class="trace-context">
                <li v-for="s in trace.context.sources" :key="s.id">{{ s.id }}</li>
              </ol>
            </section>

            <section class="trace-block" v-if="trace.finalPrompt">
              <h3>Final prompt</h3>
              <pre class="trace-prompt">{{ trace.finalPrompt }}</pre>
            </section>
          </template>
        </div>
      </aside>
    </Transition>

    <!-- Chunk modal (POC): shows the full source chunk when a chip/hit is clicked -->
    <Teleport to="body">
      <div v-if="modal" class="modal-overlay" @click.self="closeChunk" role="dialog" aria-modal="true" aria-label="Source chunk">
        <div class="modal">
          <div class="modal__head">
            <h2>{{ modal.title }}</h2>
            <button class="modal__close" type="button" @click="closeChunk" aria-label="Close">×</button>
          </div>
          <div class="modal__body">
            <p class="modal__meta">
              <span v-if="modal.score != null">score {{ formatScore(modal.score) }} · </span>
              <code>{{ modal.id }}</code>
              <template v-if="modal.url && modal.url !== '#'">
                · <a :href="modal.url" target="_blank" rel="noopener">open page</a>
              </template>
            </p>
            <div class="answer" v-html="modalHtml"></div>
          </div>
        </div>
      </div>
    </Teleport>
  </main>
</template>