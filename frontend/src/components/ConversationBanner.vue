<script setup lang="ts">
/**
 * Conversation-limit banner (Domain 10): shown when the backend ended the
 * session at the conversation cap. Offers a "nieuw gesprek" action.
 */

const emit = defineEmits<{
    /** Start a new conversation. */
    'new-session': [];
}>();
</script>

<template>
    <div
        class="flex items-center justify-between gap-3 rounded-lg border border-(--accent) bg-(--accent-soft) px-4 py-3 text-(--text)"
    >
        <p class="m-0 text-[13px]">
            Dit gesprek is afgelopen. Start een
            <button
                class="cursor-pointer border-none bg-transparent p-0 text-[13px] font-semibold text-(--accent) hover:underline"
                type="button"
                @click="emit('new-session')"
            >
                nieuw gesprek
            </button>
            om verder te gaan.
        </p>
    </div>
</template>
