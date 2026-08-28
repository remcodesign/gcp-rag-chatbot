<script setup lang="ts">
    import { computed } from 'vue';
    import { timingColor, type TimingBar } from '../lib/trace';

    /**
     * Timings modal (POC): a vertical bar graph of the per-stage timings. Shows the
     * E2E total on top and, below it, the per-stage timings stacked so they
     * (ideally) sum to E2E. Same bar width; the stack visually "fills" E2E.
     */

    const props = defineProps<{
        /** Whether the modal is open. */
        show: boolean;
        /** Per-stage timing rows (Embed, Retrieve, Rerank, Generate, E2E). */
        timingRows: TimingBar[];
    }>();

    const emit = defineEmits<{
        close: [];
    }>();

    /** The stage rows (everything except E2E), for the stacked breakdown bar. */
    const stageRows = computed(() => props.timingRows.filter((r) => r.label !== 'E2E'));
    /** The E2E row, if present. */
    const e2eRow = computed(() => props.timingRows.find((r) => r.label === 'E2E') ?? null);
    /** Sum of the stage timings (Embed + Retrieve + Rerank + Generate). */
    const stageMsTotal = computed(() =>
        stageRows.value.reduce((acc, r) => acc + r.ms, 0),
    );
    /** Width of a stage segment as a % of the summed stages (so the stack fills 100%). */
    function stagePct(ms: number): number {
        const total = stageMsTotal.value;
        if (!total) return 0;
        return (ms / total) * 100;
    }
</script>

<template>
    <Teleport to="body">
        <div v-if="show" class="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-6"
            @click.self="emit('close')" role="dialog" aria-modal="true" aria-label="Timings graph">
            <div
                class="flex max-h-[82vh] w-[min(520px,100%)] flex-col overflow-hidden rounded-xl bg-(--panel) shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                <div class="flex flex-none items-center justify-between border-b border-(--border) px-4.5 py-3.5">
                    <h2 class="m-0 text-[16px] font-bold">Timings</h2>
                    <button
                        class="cursor-pointer border-none bg-transparent text-2xl leading-none text-(--muted) hover:text-(--text)"
                        type="button" @click="emit('close')" aria-label="Close">×</button>
                </div>
                <div class="no-scrollbar overflow-y-auto p-5">
                    <p class="m-0 mb-4 text-[12px] text-(--muted)">
                        E2E time from request to last token; below it, the per-stage
                        breakdown stacked so it should sum to E2E.
                    </p>

                    <!-- E2E bar -->
                    <div class="mb-6">
                        <div class="mb-1 flex items-center justify-between text-[11px]">
                            <span class="font-semibold text-(--text)">E2E</span>
                            <span class="font-semibold text-(--text)">{{ e2eRow ? e2eRow.ms : '—' }}ms</span>
                        </div>
                        <div class="h-5 overflow-hidden rounded-full bg-(--border)">
                            <div class="h-full w-full rounded-full" :style="{ background: timingColor('E2E') }"></div>
                        </div>
                    </div>

                    <!-- Stacked per-stage bar -->
                    <div>
                        <div class="mb-1 flex items-center justify-between text-[11px]">
                            <span class="font-semibold text-(--text)">Breakdown</span>
                            <span class="font-semibold text-(--text)">{{ stageMsTotal }}ms</span>
                        </div>
                        <div class="flex h-5 w-full overflow-hidden rounded-full bg-(--border)">
                            <div v-for="row in stageRows" :key="row.label" :style="{
                                width: stagePct(row.ms) + '%',
                                background: timingColor(row.label),
                            }" :title="`${row.label}: ${row.ms}ms`"></div>
                        </div>
                    </div>

                    <!-- Legend -->
                    <div class="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                        <span v-for="row in stageRows" :key="row.label"
                            class="flex items-center gap-1.5 text-[11px] text-(--muted)">
                            <span class="inline-block h-2.5 w-2.5 rounded-sm"
                                :style="{ background: timingColor(row.label) }"></span>
                            {{ row.label }} · {{ row.ms }}ms
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>