<script setup lang="ts">
/**
 * Streaming progress indicator (Step 6.2): the animated "busy" dots next to the
 * current stage label plus a progress bar. While tokens are flowing the bar
 * switches to an indeterminate "breathing" animation instead of a width.
 */

defineProps<{
    /** Human-readable label for the current stage (e.g. "Generating"). */
    stageLabel: string;
    /** Progress percentage (0..100) for the determinate bar. */
    progress: number;
    /** Whether tokens are flowing (switches the bar to "breathing"). */
    generating: boolean;
}>();
</script>

<template>
    <div class="flex items-center gap-3 text-sm text-(--muted)" role="status" aria-live="polite">
        <span class="flex items-center gap-1.5">
            <span class="dots" aria-hidden="true"><i/><i/><i/></span>
            {{ stageLabel }}
        </span>
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-(--border)">
            <span
                class="block h-full bg-(--accent) transition-[width] duration-300"
                :class="{ 'bar-breathing': generating }"
                :style="generating ? undefined : { width: progress + '%' }"
            />
        </span>
    </div>
</template>
