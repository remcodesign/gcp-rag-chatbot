<script setup>
import { ref, computed } from 'vue';
import { createChatStore, STAGE_LABELS, STATUS } from './lib/chatStore.js';
import { openSseStream } from './lib/sseTransport.js';
import { renderAnswer, buildSourceChips } from './lib/citations.js';
import { resolveApiBase } from './lib/config.js';

// One store per app instance. The transport is the real fetch+ReadableStream
// consumer; the store drives progress, tokens, reconnection and citations.
// The backend origin comes from runtime config (separate Cloud Run service).
const store = createChatStore({
  send: (params) => openSseStream(params, { baseUrl: resolveApiBase() }),
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

const isStreaming = computed(() => status.value === STATUS.STREAMING);
const isDone = computed(() => status.value === STATUS.DONE);
const isError = computed(() => status.value === STATUS.ERROR);

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
  <main class="chat">
    <header class="chat__header">
      <h1>Northwind Outfitters — Support Chat</h1>
      <button class="chat__new" @click="newSession" :disabled="isStreaming">New session</button>
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

      <!-- Source chips (Step 6.4) -->
      <div v-if="chips.length" class="sources">
        <span class="sources__label">Sources</span>
        <a
          v-for="c in chips"
          :key="c.n"
          class="chip"
          :href="c.url"
          target="_blank"
          rel="noopener"
          :title="c.title"
        >[Source {{ c.n }}] {{ c.title }}</a>
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
  </main>
</template>