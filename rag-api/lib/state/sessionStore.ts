/**
 * Session store — stateless session + event + message persistence on Firestore.
 *
 * Domain 2. Because every backend instance writes/reads the *same* Firestore
 * collections, a request can land on any instance and still resume a session by
 * `sessionId` — this is the fix for "instances hopping". This module depends only
 * on a Firestore-shaped backend (the real `@google-cloud/firestore` client at
 * runtime, an in-memory fake in tests).
 *
 * Schema (see also `constants.ts`):
 *   sessions/{sessionId}                 -> userId, status, eventSeq, lastEventId, expiresAt
 *   sessions/{sessionId}/events/{id}     -> type, payload, seq, ts
 *   sessions/{sessionId}/messages/{id}   -> role, content, sources[], complete
 */

import {
  COLLECTIONS,
  SESSION_SUBCOLLECTIONS,
  SESSION_STATUS,
  EVENT_TYPE,
  SESSION_TTL_SECONDS,
  NO_EVENT_ID,
  type EventType,
  type MessageRole,
  type SessionStatus,
} from './constants.js';
import { SessionNotFoundError, SessionClosedError, InvalidEventError } from './errors.js';
import type { SourceInfo } from '../types/rag.js';
import type {
  Firestore,
  FirestoreDocumentData,
  FirestoreTransaction,
} from '../types/firestore.js';

// ---------------------------------------------------------------------------
// Document / API types
// ---------------------------------------------------------------------------

export interface SessionDoc extends FirestoreDocumentData {
  userId: string;
  status: SessionStatus;
  eventSeq: number;
  lastEventId: string | number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export interface EventRecord extends FirestoreDocumentData {
  sessionId: string;
  eventId: string;
  type: EventType;
  payload: Record<string, unknown>;
  seq: number;
  ts: number;
}

export interface MessageRecord extends FirestoreDocumentData {
  id: string;
  role: MessageRole;
  content: string;
  sources: SourceInfo[];
  complete: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AppendEventInput {
  type: EventType;
  payload: Record<string, unknown>;
}

export interface PersistMessageInput {
  id?: string;
  role: MessageRole;
  content?: string;
  sources?: SourceInfo[];
  complete?: boolean;
}

export interface StateStore {
  createSession(input: { sessionId: string; userId: string }): Promise<SessionDoc>;
  getSession(sessionId: string): Promise<SessionDoc | null>;
  closeSession(sessionId: string): Promise<{ sessionId: string; status: SessionStatus }>;
  extendSession(
    sessionId: string,
    lastEventId?: number | null,
  ): Promise<{ sessionId: string }>;
  appendEvent(sessionId: string, event: AppendEventInput): Promise<string>;
  appendEvents(sessionId: string, events: AppendEventInput[]): Promise<string[]>;
  listEventsAfter(sessionId: string, afterSeq?: number): Promise<EventRecord[]>;
  persistMessage(sessionId: string, message: PersistMessageInput): Promise<MessageRecord>;
  getMessage(sessionId: string, msgId: string): Promise<MessageRecord | null>;
  listMessages(sessionId: string): Promise<MessageRecord[]>;
}

interface StateStoreOptions {
  /** Idle TTL for new sessions (seconds). */
  sessionTtlSeconds?: number;
  /** Time source in ms (tests inject a fake). */
  clock?: () => number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the Domain-2 state API bound to a Firestore-shaped backend.
 */
export function createStateStore(
  firestore: Firestore,
  options: StateStoreOptions = {},
): StateStore {
  const sessionTtlSeconds = options.sessionTtlSeconds ?? SESSION_TTL_SECONDS.DEFAULT_SESSION;
  const clock = options.clock ?? (() => Date.now());

  function sessionDocRef(sessionId: string) {
    return firestore.collection(COLLECTIONS.SESSIONS).doc(sessionId);
  }

  function eventsColRef(sessionId: string) {
    return sessionDocRef(sessionId).collection(SESSION_SUBCOLLECTIONS.EVENTS);
  }

  function messagesColRef(sessionId: string) {
    return sessionDocRef(sessionId).collection(SESSION_SUBCOLLECTIONS.MESSAGES);
  }

  async function transactionRun<TResult>(fn: (t: FirestoreTransaction) => Promise<TResult>) {
    return firestore.runTransaction(fn);
  }

  async function createSession({ sessionId, userId }: { sessionId: string; userId: string }) {
    const ref = sessionDocRef(sessionId);
    const nowMs = clock();
    return transactionRun(async (t) => {
      const existing = await t.get(ref);
      if (existing.exists) {
        return existing.data() as SessionDoc;
      }
      const data: SessionDoc = {
        userId,
        status: SESSION_STATUS.ACTIVE,
        eventSeq: 0,
        lastEventId: NO_EVENT_ID,
        createdAt: nowMs,
        updatedAt: nowMs,
        expiresAt: nowMs + sessionTtlSeconds * 1000,
      };
      t.set(ref, data);
      return data;
    });
  }

  async function getSession(sessionId: string) {
    const snap = await sessionDocRef(sessionId).get();
    return snap.exists ? (snap.data() as SessionDoc) : null;
  }

  async function closeSession(sessionId: string) {
    const ref = sessionDocRef(sessionId);
    return transactionRun(async (t) => {
      const existing = await t.get(ref);
      if (!existing.exists) throw new SessionNotFoundError(sessionId);
      t.update(ref, {
        status: SESSION_STATUS.CLOSED,
        updatedAt: clock(),
        expiresAt: null, // clear the TTL trigger: closed sessions are kept until purged
      });
      return { sessionId, status: SESSION_STATUS.CLOSED };
    });
  }

  async function extendSession(sessionId: string, lastEventId: number | null = null) {
    const ref = sessionDocRef(sessionId);
    return transactionRun(async (t) => {
      const existing = await t.get(ref);
      if (!existing.exists) throw new SessionNotFoundError(sessionId);
      if (existing.data()?.status !== SESSION_STATUS.ACTIVE) {
        throw new SessionClosedError(sessionId);
      }
      const patch: Partial<SessionDoc> = { updatedAt: clock() };
      if (lastEventId != null) patch.lastEventId = lastEventId;
      t.update(ref, patch);
      return { sessionId };
    });
  }

  async function appendEvent(sessionId: string, event: AppendEventInput): Promise<string> {
    const ids = await appendEvents(sessionId, [event]);
    return ids[0] ?? '';
  }

  async function appendEvents(sessionId: string, events: AppendEventInput[]): Promise<string[]> {
    if (!Array.isArray(events) || events.length === 0) {
      throw new InvalidEventError('appendEvents requires at least one event');
    }
    const sessionRef = sessionDocRef(sessionId);
    return transactionRun(async (t) => {
      const snap = await t.get(sessionRef);
      if (!snap.exists) throw new SessionNotFoundError(sessionId);
      const sess = snap.data() as SessionDoc;
      if (sess.status !== SESSION_STATUS.ACTIVE) {
        throw new SessionClosedError(sessionId);
      }

      let seq = sess.eventSeq ?? 0;
      const written: string[] = [];
      const eventsRef = eventsColRef(sessionId);
      for (const ev of events) {
        validateEvent(ev.type, ev.payload);
        seq += 1;
        const id = String(seq).padStart(6, '0'); // stable, orderable string id
        const eventDoc: EventRecord = {
          sessionId,
          eventId: id,
          type: ev.type,
          payload: ev.payload,
          seq,
          ts: clock(),
        };
        t.set(eventsRef.doc(id), eventDoc);
        written.push(id);
      }

      t.update(sessionRef, {
        eventSeq: seq,
        lastEventId: written[written.length - 1],
        updatedAt: clock(),
      });
      return written;
    });
  }

  async function listEventsAfter(sessionId: string, afterSeq = NO_EVENT_ID): Promise<EventRecord[]> {
    const col = eventsColRef(sessionId);
    const query = col.orderBy('seq', 'asc').startAfter(afterSeq);
    const snap = await query.get();
    return snap.docs
      .map((d) => d.data())
      .filter((d): d is EventRecord => d != null);
  }

  async function persistMessage(
    sessionId: string,
    message: PersistMessageInput,
  ): Promise<MessageRecord> {
    const col = messagesColRef(sessionId);
    const msgId = message.id ?? `m-${clock()}`;
    const ref = col.doc(msgId);
    const data: MessageRecord = {
      id: msgId,
      role: message.role,
      content: message.content ?? '',
      sources: message.sources ?? [],
      complete: message.complete ?? false,
      createdAt: clock(),
      updatedAt: clock(),
    };
    await ref.set(data, { merge: true });
    return data;
  }

  async function getMessage(sessionId: string, msgId: string) {
    const snap = await messagesColRef(sessionId).doc(msgId).get();
    return snap.exists ? (snap.data() as MessageRecord) : null;
  }

  async function listMessages(sessionId: string): Promise<MessageRecord[]> {
    const snap = await messagesColRef(sessionId).orderBy('createdAt', 'asc').get();
    return snap.docs
      .map((d) => d.data())
      .filter((d): d is MessageRecord => d != null);
  }

  return {
    createSession,
    getSession,
    closeSession,
    extendSession,
    appendEvent,
    appendEvents,
    listEventsAfter,
    persistMessage,
    getMessage,
    listMessages,
  };
}

function validateEvent(type: string, payload: Record<string, unknown>): void {
  const allowed = Object.values(EVENT_TYPE);
  if (!allowed.includes(type as EventType)) {
    throw new InvalidEventError(`Unsupported event type "${type}"`);
  }
  if (payload === undefined || payload === null) {
    throw new InvalidEventError('Event payload is required');
  }
}