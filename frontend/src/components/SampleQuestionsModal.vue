<script setup lang="ts">
import type { SampleGroup } from '../lib/sampleQuestions';

/**
 * Sample questions modal (POC): a grouped picker of quick-start questions (one
 * group per corpus folder). Owns its own `<Teleport to="body">`; the parent
 * owns the open/close boolean and the pick action.
 */

defineProps<{
    /** Whether the modal is open. */
    show: boolean;
    /** The grouped sample questions to render. */
    groups: SampleGroup[];
}>();

const emit = defineEmits<{
    close: [];
    /** A sample question was picked (sends it immediately). */
    pick: [text: string];
}>();
</script>

<template>
    <Teleport to="body">
        <div
            v-if="show"
            class="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-6"
            @click.self="emit('close')"
            role="dialog"
            aria-modal="true"
            aria-label="Sample questions"
        >
            <div
                class="flex max-h-[82vh] w-[min(880px,100%)] flex-col overflow-hidden rounded-xl bg-(--panel) shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            >
                <div
                    class="flex flex-none items-center justify-between border-b border-(--border) px-4.5 py-3.5"
                >
                    <h2 class="m-0 text-[16px] font-bold">Sample questions</h2>
                    <button
                        class="cursor-pointer border-none bg-transparent text-2xl leading-none text-(--muted) hover:text-(--text)"
                        type="button"
                        @click="emit('close')"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
                <div class="no-scrollbar overflow-y-auto p-5">
                    <p class="m-0 mb-4 text-[12px] text-(--muted)">
                        Pick a question to get started. Select one and it sends immediately.
                    </p>
                    <div class="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                        <div v-for="group in groups" :key="group.folder">
                            <h3
                                class="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-(--muted)"
                            >
                                {{ group.label }}
                            </h3>
                            <div class="flex flex-col gap-1.5">
                                <button
                                    v-for="q in group.questions"
                                    :key="q.text"
                                    type="button"
                                    class="cursor-pointer rounded-lg border border-(--border) bg-(--bg) px-3 py-2 text-left text-[13px] text-(--text) transition-colors hover:border-(--accent) hover:text-(--accent)"
                                    @click="emit('pick', q.text)"
                                >
                                    {{ q.text }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
