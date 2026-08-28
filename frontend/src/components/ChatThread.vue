<script setup lang="ts">
import { ref } from 'vue';
import { renderAnswer } from '../lib/citations';
import { formatTime } from '../lib/format';
import type { ConversationMessage } from '../types/chat';
import type { Source } from '../types/sse';

/**
 * The WhatsApp-style chat thread: the completed transcript (my messages as
 * right bubbles, assistant replies full-width without a bubble) plus the live
 * streaming assistant answer below it. The scroll container lives here; the
 * parent owns the auto-scroll behaviour via the exposed `scrollToBottom`.
 */

defineProps<{
    /** The completed conversation transcript. */
    transcript: ConversationMessage[];
    /** The assistant answer currently streaming (rendered live below). */
    liveAnswerHtml: string;
}>();

const emit = defineEmits<{
    /** A source chip was clicked (opens the chunk modal). */
    'open-chunk': [chunk: Source];
}>();

/** The scrollable thread container (exposed for auto-scroll). */
const threadEl = ref<HTMLElement | null>(null);

/** Smooth-scrolls the thread to the bottom (as far as content reaches). */
function scrollToBottom(): void {
    const el = threadEl.value;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

defineExpose({ scrollToBottom });

/** Renders one message body (markdown for assistant, plain for user). */
function renderMessageHtml(content: string, role: 'user' | 'assistant'): string {
    return role === 'assistant' ? renderAnswer(content) : content;
}
</script>

<template>
    <section
        ref="threadEl"
        class="no-scrollbar min-h-0 flex-1 overflow-y-auto rounded-xl border border-(--border) bg-(--panel) p-5"
    >
        <div v-if="transcript.length === 0" class="text-(--muted)">
            Ask about returns, warranty, sizing, or product setup.
        </div>

        <!-- WhatsApp-style transcript: my messages as right bubbles, the
             assistant full-width without a bubble. -->
        <div v-else class="flex flex-col gap-4">
            <div
                v-for="(m, i) in transcript"
                :key="i"
                class="flex flex-col"
                :class="m.role === 'user' ? 'items-end' : 'items-start'"
            >
                <!-- Small line with the sender + time, above each message -->
                <div
                    class="mb-1 flex items-center gap-1.5 text-[11px] text-(--muted)"
                    :class="m.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
                >
                    <span class="font-semibold">{{
                        m.role === 'user' ? 'Jij' : 'Northwind Assistent'
                    }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ formatTime(m.createdAt) }}</span>
                </div>

                <!-- User: right-aligned bubble. Assistant: full-width, no bubble. -->
                <div
                    v-if="m.role === 'user'"
                    class="max-w-[80%] rounded-2xl rounded-br-md bg-(--accent) px-3.5 py-2.5 text-white shadow-sm"
                >
                    <p class="m-0 whitespace-pre-wrap text-[14px] leading-[1.45]">
                        {{ m.content }}
                    </p>
                </div>

                <div v-else class="w-full">
                    <div
                        class="answer leading-normal text-(--text)"
                        v-html="renderMessageHtml(m.content, 'assistant')"
                    ></div>
                    <!-- Source chips for the assistant reply -->
                    <div
                        v-if="m.sources && m.sources.length"
                        class="mt-3 flex flex-wrap items-center gap-2 border-t border-(--border) pt-3"
                    >
                        <span class="text-[13px] text-(--muted)">Sources</span>
                        <button
                            v-for="c in m.sources"
                            :key="c.n"
                            class="cursor-pointer rounded-full border border-transparent bg-(--accent-soft) px-3 py-1 text-[13px] text-(--accent) hover:underline"
                            type="button"
                            :title="c.title"
                            @click="emit('open-chunk', c)"
                        >
                            [Source {{ c.n }}] {{ c.title }}
                        </button>
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
                <div
                    class="answer w-full leading-normal text-(--text)"
                    v-html="liveAnswerHtml"
                ></div>
            </div>
        </div>
    </section>
</template>
