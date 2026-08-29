<script setup lang="ts">
import { MAX_CONVERSATION_TURNS } from '~/lib/chatStore';

/**
 * Chat page header: title, the turn counter pill, the RAG-trace toggle and the
 * "New session" button. Pure presentational — all state flows in via props and
 * actions flow out via emits.
 */

defineProps<{
    /** Completed turns in this conversation (X in "X / 5"). */
    turnCount: number;
    /** Whether the user can still ask (below the cap and not ended). */
    canAsk: boolean;
    /** Whether the RAG trace sidebar is currently open. */
    traceOpen: boolean;
    /** Whether a stream is in flight (disables "New session"). */
    streaming: boolean;
}>();

const emit = defineEmits<{
    /** Toggle the RAG trace sidebar. */
    'toggle-trace': [];
    /** Start a new conversation. */
    'new-session': [];
}>();
</script>

<template>
    <header class="flex items-center justify-between">
        <h1 class="m-0 text-xl">Northwind Outfitters — Support Chat</h1>
        <div class="flex items-center gap-2">
            <span
                class="rounded-full border border-(--border) px-3 py-1.5 text-[13px]"
                :class="canAsk ? 'text-(--muted)' : 'text-(--danger)'"
                :title="'Vragen in dit gesprek: ' + turnCount + ' van ' + MAX_CONVERSATION_TURNS"
                >{{ turnCount }} / {{ MAX_CONVERSATION_TURNS }}</span
            >
            <button
                class="cursor-pointer rounded-lg border border-(--border) px-3 py-1.5 text-(--text)"
                :aria-expanded="traceOpen"
                @click="emit('toggle-trace')"
            >
                <span
                    class="mr-1.5 inline-block h-2 w-2 rounded-full bg-(--accent) align-middle"
                    aria-hidden="true"
                />
                {{ traceOpen ? 'Hide RAG trace' : 'RAG trace' }}
            </button>
            <button
                class="cursor-pointer rounded-lg border border-(--border) px-3 py-1.5 text-(--text) disabled:cursor-default disabled:opacity-50"
                :disabled="streaming"
                @click="emit('new-session')"
            >
                New session
            </button>
        </div>
    </header>
</template>
