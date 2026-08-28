<script setup lang="ts">
import { computed } from 'vue';
import { renderAnswer } from '../lib/citations';
import { formatScore } from '../lib/trace';
import type { ChunkModal } from '../lib/chunkModal';

/**
 * Chunk modal (POC): shows the full source chunk when a chip / trace hit is
 * clicked. Owns its own `<Teleport to="body">` so it is self-contained; the
 * parent owns the open/close boolean and passes the selected chunk in.
 */

const props = defineProps<{
    /** The selected chunk to render, or null when closed. */
    chunk: ChunkModal | null;
}>();

const emit = defineEmits<{
    close: [];
}>();

/** Rendered HTML for the chunk body (markdown). */
const chunkHtml = computed(() => (props.chunk ? renderAnswer(props.chunk.text) : ''));
</script>

<template>
    <Teleport to="body">
        <div
            v-if="chunk"
            class="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-6"
            @click.self="emit('close')"
            role="dialog"
            aria-modal="true"
            aria-label="Source chunk"
        >
            <div
                class="flex max-h-[82vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-xl bg-(--panel) shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            >
                <div
                    class="flex flex-none items-center justify-between border-b border-(--border) px-4.5 py-3.5"
                >
                    <h2 class="m-0 text-[16px] font-bold">{{ chunk.title }}</h2>
                    <button
                        class="cursor-pointer border-none bg-transparent text-2xl leading-none text-(--muted) hover:text-(--text)"
                        type="button"
                        @click="emit('close')"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
                <div class="modal-body no-scrollbar overflow-y-auto p-4 px-4.5">
                    <p class="my-0 mb-3 break-all text-[12px] text-(--muted)">
                        <span v-if="chunk.score != null"
                            >score {{ formatScore(chunk.score) }} ·
                        </span>
                        <code class="rounded bg-(--accent-soft) px-1">{{ chunk.id }}</code>
                    </p>
                    <div class="answer leading-normal" v-html="chunkHtml"></div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
