import { describe, it, expect, beforeEach } from 'vitest';
import { createStateStore } from '../../lib/state/sessionStore.js';
import type { StateStore } from '../../lib/state/sessionStore.js';
import { SESSION_STATUS, EVENT_TYPE, NO_EVENT_ID } from '../../lib/state/constants.js';
import { SessionNotFoundError, SessionClosedError, InvalidEventError } from '../../lib/state/errors.js';
import { createFakeFirestore } from '../fakes/fakeFirestore.js';
import type { FakeFirestore } from '../fakes/fakeFirestore.js';

const SID = 'sess-1';
const UID = 'user-1';

function makeStore(options: { clock?: () => number } = {}): {
    firestore: FakeFirestore;
    store: StateStore;
    clock: () => number;
} {
    const firestore = createFakeFirestore();
    const clock = options.clock ?? (() => 1_000_000);
    const store = createStateStore(firestore, { clock, sessionTtlSeconds: 3600 });
    return { firestore, store, clock };
}

describe('Step 2.1 — Firestore client and schema', () => {
    describe('createSession / getSession', () => {
        it('persists a session doc with status, eventSeq and expiresAt', async () => {
            const { store } = makeStore();
            const s = await store.createSession({ sessionId: SID, userId: UID });
            expect(s.status).toBe('active');
            expect(s.eventSeq).toBe(0);
            expect(s.expiresAt).toBe(1_000_000 + 3600 * 1000);

            const read = await store.getSession(SID);
            expect(read).toMatchObject({ userId: UID, status: 'active', lastEventId: NO_EVENT_ID });
        });

        it('is idempotent — recreating an existing session returns it unchanged', async () => {
            const { store } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            const again = await store.createSession({ sessionId: SID, userId: 'other' });
            expect(again.userId).toBe(UID); // original kept
            expect((await store.getSession(SID))?.userId).toBe(UID);
        });

        it('returns null for an unknown session', async () => {
            const { store } = makeStore();
            expect(await store.getSession('missing')).toBeNull();
        });
    });

    describe('closeSession / extendSession', () => {
        it('rejects writing an event for a closed session', async () => {
            const { store } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            await store.closeSession(SID);
            await expect(
                store.appendEvent(SID, { type: EVENT_TYPE.TOKEN, payload: { text: 'x' } }),
            ).rejects.toThrow(SessionClosedError);
        });

        it('throws SessionNotFoundError when closing an unknown session', async () => {
            const { store } = makeStore();
            await expect(store.closeSession('nope')).rejects.toThrow(SessionNotFoundError);
        });

        it('extends an active session TTL and advances lastEventId', async () => {
            const { store } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            await store.extendSession(SID, 2);
            const s = await store.getSession(SID);
            expect(s?.lastEventId).toBe(2);
            expect(s?.status).toBe('active');
        });

        it('does not extend a closed session', async () => {
            const { store } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            await store.closeSession(SID);
            await expect(store.extendSession(SID)).rejects.toThrow(SessionClosedError);
        });
    });

    describe('appendEvent', () => {
        it('assigns monotonic seq ids and bumps eventSeq atomically', async () => {
            const { store } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            const a = await store.appendEvent(SID, { type: EVENT_TYPE.PROGRESS, payload: { stage: 'retrieval', progress: 40 } });
            const b = await store.appendEvent(SID, { type: EVENT_TYPE.PROGRESS, payload: { stage: 'rerank', progress: 70 } });
            expect(a).toBe('000001');
            expect(b).toBe('000002');
            const s = await store.getSession(SID);
            expect(s?.eventSeq).toBe(2);
            expect(s?.lastEventId).toBe('000002');
        });

        it('throws InvalidEventError for an unsupported type and writes nothing', async () => {
            const { store, firestore } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            await expect(
                store.appendEvent(SID, {
                    type: 'wat' as unknown as typeof EVENT_TYPE.PROGRESS,
                    payload: {},
                }),
            ).rejects.toThrow(InvalidEventError);
            expect(firestore.store.size).toBe(1); // only the session doc, no event written
        });

        it('throws SessionNotFoundError when appending to an unknown session', async () => {
            const { store } = makeStore();
            await expect(
                store.appendEvent('missing', { type: EVENT_TYPE.PROGRESS, payload: {} }),
            ).rejects.toThrow(SessionNotFoundError);
        });
    });

    describe('appendEvents (batch)', () => {
        it('appends many events in one atomic transaction with sequential ids', async () => {
            const { store } = makeStore();
            await store.createSession({ sessionId: SID, userId: UID });
            const ids = await store.appendEvents(SID, [
                { type: EVENT_TYPE.PROGRESS, payload: { stage: 'retrieval' } },
                { type: EVENT_TYPE.TOKEN, payload: { text: 'hello' } },
                { type: EVENT_TYPE.PROGRESS, payload: { stage: 'generation' } },
            ]);
            expect(ids).toEqual(['000001', '000002', '000003']);
        });
    });
});

describe('Step 2.2 — Reconnection / resume logic', () => {
    it('replays events strictly after lastEventId on reconnect', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        await store.appendEvents(SID, [
            { type: EVENT_TYPE.PROGRESS, payload: { stage: 'retrieval' } },
            { type: EVENT_TYPE.TOKEN, payload: { text: 'one' } },
            { type: EVENT_TYPE.TOKEN, payload: { text: 'two' } },
        ]);
        const replayed = await store.listEventsAfter(SID, 1);
        expect(replayed.map((e) => (e.payload as { text: string }).text)).toEqual(['one', 'two']);
        expect(replayed.map((e) => e.seq)).toEqual([2, 3]);
    });

    it('dedupes an already-sent event id — replay starts after the acknowledged seq', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        await store.appendEvent(SID, { type: EVENT_TYPE.TOKEN, payload: { text: 'dup-suspected' } });
        const replayed = await store.listEventsAfter(SID, 1);
        expect(replayed).toEqual([]);
    });

    it('replays everything when the client reconnects from the start', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        await store.appendEvent(SID, { type: EVENT_TYPE.PROGRESS, payload: { stage: 'retrieval' } });
        const replayed = await store.listEventsAfter(SID, NO_EVENT_ID);
        expect(replayed).toHaveLength(1);
    });
});

describe('Step 2.3 — Session TTL / cleanup', () => {
    it('marks a session closed after idle TTL expiry (guard path)', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        await store.closeSession(SID);
        const s = await store.getSession(SID);
        expect(s?.status).toBe('closed');
    });

    it('does not expire an active streaming session — active guard still writes events', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        const id = await store.appendEvent(SID, { type: EVENT_TYPE.TOKEN, payload: { text: 'still streaming' } });
        expect(id).toBe('000001');
        expect((await store.getSession(SID))?.status).toBe('active');
    });
});

describe('Step 2.1 — messages', () => {
    it('persists and reads back a message with sources and complete flag', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        const msg = await store.persistMessage(SID, {
            id: 'm1',
            role: 'assistant',
            content: 'You can return within 30 days.',
            sources: [{ id: 'faq-returns-01', title: 'Return policy', url: '' }],
            complete: true,
        });
        expect(msg.complete).toBe(true);
        const read = await store.getMessage(SID, 'm1');
        expect(read).toMatchObject({ role: 'assistant', content: 'You can return within 30 days.' });
        expect(read?.sources[0]?.id).toBe('faq-returns-01');
    });

    it('lists messages oldest first', async () => {
        const { store } = makeStore();
        await store.createSession({ sessionId: SID, userId: UID });
        await store.persistMessage(SID, { id: 'm2', role: 'user', content: 'hi' });
        await store.persistMessage(SID, { id: 'm1', role: 'assistant', content: 'hello' });
        const msgs = await store.listMessages(SID);
        expect(msgs.map((m) => m.content)).toEqual(['hi', 'hello']);
    });
});