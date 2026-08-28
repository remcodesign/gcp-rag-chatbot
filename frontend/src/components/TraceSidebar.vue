<script setup lang="ts">
import { MAX_CONVERSATION_TURNS } from '../lib/chatStore';
import {
    formatCost,
    formatScore,
    formatTokensPerSecond,
    timingColor,
    type TimingBar,
} from '../lib/trace';
import type { Source } from '../types/sse';
import type { NormalizedTrace, TraceHit } from '../types/trace';

/**
 * RAG "inner workings" sidebar (POC). Renders the backend `trace` payload that
 * the chatStore retains: query, rerank decision, per-stage timings, token
 * usage, retrieved chunks and the context passed to the LLM. It is a closable
 * panel on small screens and a static sidebar on large screens (the drawer
 * transition lives in the parent around this component).
 */

defineProps<{
    /** The normalized trace payload, or null before the first answer. */
    trace: NormalizedTrace | null;
    /** Whether the user can still ask (below the cap and not ended). */
    canAsk: boolean;
    /** Completed turns in this conversation (X in "X / 5"). */
    turnCount: number;
    /** Whether the backend ended the session at the conversation limit. */
    conversationEnded: boolean;
    /** Per-stage timing rows for the horizontal bars. */
    timingRows: TimingBar[];
    /** Whether any token-usage / token-speed data is available to render. */
    hasUsage: boolean;
}>();

const emit = defineEmits<{
    close: [];
    /** A source chip or trace hit was clicked (opens the chunk modal). */
    'open-chunk': [chunk: Source | TraceHit];
    /** The "Graph" button was clicked (opens the timings modal). */
    'open-timings': [];
}>();
</script>

<template>
    <aside
        class="trace-panel fixed bottom-[84px] right-0 top-0 z-30 flex w-[min(380px,92vw)] flex-col border-l border-(--border) bg-(--panel) shadow-[_-6px_0_24px_rgba(0,0,0,0.12)] lg:static lg:h-full lg:w-[340px] lg:shrink-0 lg:rounded-xl lg:border lg:bg-(--panel) lg:shadow-none"
        aria-label="RAG trace details"
    >
        <div
            class="flex flex-none items-center justify-between border-b border-(--border) px-4 py-3.5"
        >
            <h2 class="m-0 text-[15px] font-bold">RAG trace</h2>
            <button
                class="cursor-pointer border-none bg-transparent text-[22px] leading-none text-(--muted) hover:text-(--text)"
                @click="emit('close')"
                aria-label="Close RAG trace"
            >
                ×
            </button>
        </div>
        <div class="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div
                class="mb-4 rounded-lg border border-(--border) px-3 py-2.5 text-[12px]"
                :class="canAsk ? 'text-(--muted)' : 'border-(--danger) text-(--danger)'"
            >
                Gesprek: {{ turnCount }} / {{ MAX_CONVERSATION_TURNS }}
                <span v-if="conversationEnded"> — klaar, start een nieuw gesprek.</span>
            </div>

            <p v-if="!trace" class="text-[14px] text-(--muted)">
                No RAG trace yet — ask a question to see retrieval, rerank, context and the final
                prompt.
            </p>

            <template v-else>
                <section
                    v-if="trace.error"
                    class="mb-4 rounded-lg border border-(--danger) bg-(--danger-soft) px-3 py-2.5 text-[12px] text-(--danger)"
                    role="alert"
                >
                    Retrieval failed — answering without context. {{ trace.error.message }}
                </section>

                <div class="mb-6">
                    <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                        Query
                    </h3>
                    <p class="m-0 mb-1 text-[14px] font-semibold">{{ trace.query }}</p>
                </div>

                <div class="mb-6">
                    <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                        Rerank
                    </h3>
                    <p class="my-0.5 text-[12px] text-(--muted)">
                        {{ trace.rerank.didRerank ? 'Reranked' : 'Skipped rerank' }} —
                        {{ trace.rerank.reason }}
                    </p>
                </div>

                <div class="mb-6">
                    <div class="mb-1.5 flex items-center justify-between">
                        <h3 class="m-0 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                            Timings
                        </h3>
                        <button
                            v-if="timingRows.length"
                            class="cursor-pointer rounded border border-(--border) px-2 py-0.5 text-[11px] text-(--muted) hover:text-(--text)"
                            type="button"
                            @click="emit('open-timings')"
                        >
                            Graph
                        </button>
                    </div>
                    <div v-if="timingRows.length" class="mt-2 flex flex-col gap-1.5">
                        <div
                            v-for="row in timingRows"
                            :key="row.label"
                            class="flex items-center gap-2 text-[11px]"
                        >
                            <span class="w-14 shrink-0 text-(--muted)">{{ row.label }}</span>
                            <span class="h-2 flex-1 overflow-hidden rounded-full bg-(--border)">
                                <span
                                    class="block h-full rounded-full"
                                    :style="{
                                        width: row.pct + '%',
                                        background: timingColor(row.label),
                                    }"
                                ></span>
                            </span>
                            <span class="w-14 shrink-0 text-right font-semibold text-(--text)"
                                >{{ row.ms }}ms</span
                            >
                        </div>
                    </div>
                </div>

                <div v-if="hasUsage" class="mb-6">
                    <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                        Token usage
                    </h3>
                    <div class="mt-2 flex flex-col gap-1.5">
                        <div
                            v-if="trace.usage?.promptTokens != null"
                            class="flex items-center gap-2 text-[11px]"
                        >
                            <span class="w-14 shrink-0 text-(--muted)">Prompt</span>
                            <span class="text-[11px] font-semibold text-(--text)"
                                >{{ trace.usage.promptTokens }} tok</span
                            >
                        </div>
                        <div
                            v-if="trace.usage?.completionTokens != null"
                            class="flex items-center gap-2 text-[11px]"
                        >
                            <span class="w-14 shrink-0 text-(--muted)">Output</span>
                            <span class="text-[11px] font-semibold text-(--text)"
                                >{{ trace.usage.completionTokens }} tok</span
                            >
                        </div>
                        <div
                            v-if="trace.usage?.totalTokens != null"
                            class="flex items-center gap-2 text-[11px]"
                        >
                            <span class="w-14 shrink-0 text-(--muted)">Total</span>
                            <span class="text-[11px] font-semibold text-(--text)"
                                >{{ trace.usage.totalTokens }} tok</span
                            >
                        </div>
                        <div
                            v-if="trace.ttftMs != null"
                            class="flex items-center gap-2 text-[11px]"
                        >
                            <span class="w-14 shrink-0 text-(--muted)">TTFT</span>
                            <span class="text-[11px] font-semibold text-(--text)"
                                >{{ trace.ttftMs }}ms</span
                            >
                        </div>
                        <div class="flex items-center gap-2 text-[11px]">
                            <span class="w-14 shrink-0 text-(--muted)">Speed</span>
                            <span class="text-[11px] font-semibold text-(--text)">{{
                                formatTokensPerSecond(trace.tokensPerSecond)
                            }}</span>
                        </div>
                        <div
                            v-if="trace.usage?.cost != null"
                            class="flex items-center gap-2 text-[11px]"
                        >
                            <span class="w-14 shrink-0 text-(--muted)">Cost</span>
                            <span class="text-[11px] font-semibold text-(--text)">{{
                                formatCost(trace.usage.cost)
                            }}</span>
                        </div>
                    </div>
                </div>

                <div class="mb-6">
                    <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                        Retrieval ({{ trace.retrieved.length }})
                    </h3>
                    <ul class="m-0 flex list-none flex-col gap-2 p-0">
                        <li
                            v-for="c in trace.retrieved"
                            :key="c.id"
                            class="rounded-lg border border-(--border) px-2.5 py-2"
                            :class="{ 'opacity-55': !c.keptInContext }"
                        >
                            <div class="flex items-center gap-2">
                                <span
                                    class="rounded bg-(--accent-soft) px-1.5 text-[11px] font-bold text-(--accent)"
                                    >#{{ c.rank }}</span
                                >
                                <button
                                    class="min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-left text-[13px] font-semibold text-(--text) hover:text-(--accent) hover:underline"
                                    type="button"
                                    @click="emit('open-chunk', c)"
                                >
                                    {{ c.title }}
                                </button>
                                <span class="text-[12px] font-semibold text-(--muted)">{{
                                    formatScore(c.score)
                                }}</span>
                            </div>
                            <div class="my-0.5 text-[11px] text-(--muted)">
                                {{ c.chars }} chars ·
                                {{ c.keptInContext ? 'in context' : 'dropped' }}
                            </div>
                            <p
                                class="m-0 mt-1 text-[12px] leading-[1.45] whitespace-pre-wrap text-[#3b4757]"
                            >
                                {{ c.textPreview }}
                            </p>
                        </li>
                    </ul>
                </div>

                <div class="mb-6">
                    <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                        Context passed to LLM ({{ trace.context.sources.length }})
                    </h3>
                    <ol class="m-0 pl-4 text-[12px] text-(--muted)">
                        <li v-for="s in trace.context.sources" :key="s.id" class="my-0.5">
                            {{ s.id }}
                        </li>
                    </ol>
                </div>

                <div v-if="trace.finalPrompt" class="mb-4">
                    <h3 class="m-0 mb-1.5 text-[12px] uppercase tracking-[0.05em] text-(--muted)">
                        Final prompt
                    </h3>
                    <pre
                        class="no-scrollbar m-0 max-h-120 overflow-y-auto whitespace-pre-wrap rounded-lg border border-(--border) bg-(--bg) px-2.5 py-2.5 text-[11px] text-(--text)"
                        >{{ trace.finalPrompt }}</pre>
                </div>
            </template>
        </div>
    </aside>
</template>
