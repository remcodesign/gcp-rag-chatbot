<script setup lang="ts">
/**
 * Chat input row: the "+" sample-questions button, the text input and the Send
 * button. The parent owns the input value and the submit/sample actions.
 */

defineProps<{
    /** The current input value (v-model). */
    modelValue: string;
    /** Whether a stream is in flight (disables input + send). */
    streaming: boolean;
    /** Whether the user can still ask (below the cap and not ended). */
    canAsk: boolean;
}>();

const emit = defineEmits<{
    /** Update the input value (v-model). */
    'update:modelValue': [value: string];
    /** Submit the current input. */
    submit: [];
    /** Open the sample-questions picker. */
    'open-samples': [];
}>();

function onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    emit('update:modelValue', target.value);
}
</script>

<template>
    <form class="flex flex-none gap-2" @submit.prevent="emit('submit')">
        <button
            type="button"
            class="shrink-0 cursor-pointer rounded-[10px] border border-(--border) bg-(--panel) px-3 text-[20px] leading-none text-(--muted) hover:text-(--accent) disabled:cursor-default disabled:opacity-50"
            :disabled="streaming"
            :title="'Sample questions'"
            aria-label="Sample questions"
            @click="emit('open-samples')"
        >
            +
        </button>
        <input
            :value="modelValue"
            type="text"
            :placeholder="
                canAsk ? 'Ask a question…' : 'Start een nieuw gesprek om verder te vragen'
            "
            :disabled="streaming || !canAsk"
            autocomplete="off"
            class="flex-1 rounded-[10px] border border-(--border) bg-(--panel) px-3.5 py-3 text-[15px] shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_rgba(16,24,40,0.05)] placeholder:text-(--muted)"
            @input="onInput"
        >
        <button
            type="submit"
            class="cursor-pointer rounded-[10px] bg-(--accent) px-5 text-white disabled:cursor-default disabled:opacity-50"
            :disabled="streaming || !modelValue.trim() || !canAsk"
        >
            Send
        </button>
    </form>
</template>
