<script setup lang="ts">
/**
 * Error banner (Step 6.1 non-happy): shown when the stream ends in an error.
 * Displays the message plus an optional detail line and a Retry action.
 */

defineProps<{
    /** The primary error message. */
    message: string;
    /** Optional secondary detail line (e.g. "HTTP 429 — rate limited"). */
    detail: string;
}>();

const emit = defineEmits<{
    /** Retry the last request. */
    retry: [];
}>();
</script>

<template>
    <div
        class="flex items-center justify-between gap-3 rounded-lg border border-(--danger) bg-(--danger-soft) px-4 py-3 text-(--danger)"
        role="alert"
    >
        <div class="min-w-0">
            <p class="m-0 font-semibold">{{ message }}</p>
            <p v-if="detail" class="m-0 mt-0.5 text-[12px] break-words opacity-80">
                {{ detail }}
            </p>
        </div>
        <button
            class="shrink-0 cursor-pointer rounded-lg bg-(--danger) px-3 py-1.5 text-white"
            @click="emit('retry')"
        >
            Retry
        </button>
    </div>
</template>
