/**
 * Session store — stateless session + event + message persistence on Firestore.
 *
 * Domain 2. Because every backend instance writes/reads the *same* Firestore
 * collections, a request can land on any instance and still resume a session by
 * `sessionId` — this is the fix for "instances hopping". This module depends only
 * on a Firestore-shaped backend (the real `@google-cloud/firestore` client at
 * runtime, an in-memory fake in tests).
 *
 * Schema (see also `constants.js`):
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
} from './constants.js';
import { SessionNotFoundError, SessionClosedError, InvalidEventError } from './errors.js';

/**
 * Creates the Domain-2 state API bound to a Firestore-shaped backend.
 *
 * @param {object} firestore  Firestore instance (real or fake). Must expose
 *   `collection()`, `runTransaction()`, `batch()`, and `Timestamp`.
 * @param {object} [options]
 * @param {number} [options.sessionTtlSeconds]  idle TTL for new sessions (seconds).
 * @param {() => number} [options.clock]  time source in ms (tests inject a fake).
 * @returns {object} see below.
 */
export function createStateStore(firestore, options = {}) {
  const sessionTtlSeconds = options.sessionTtlSeconds ?? SESSION_TTL_SECONDS.DEFAULT_SESSION;
  const clock = options.clock ?? (() => Date.now());

  function sessionDocRef(sessionId) {
    return firestore.collection(COLLECTIONS.SESSIONS).doc(sessionId);
  }

  function eventsColRef(sessionId) {
    return sessionDocRef(sessionId).collection(SESSION_SUBCOLLECTIONS.EVENTS);
  }

  function messagesColRef(sessionId) {
    return sessionDocRef(sessionId).collection(SESSION_SUBCOLLECTIONS.MESSAGES);
  }

  async function transactionRun(fn) {
    return firestore.runTransaction(fn);
  }

  /**
   * Creates a new session at `sessionId`.
   *
   * Uses a transaction so the create is atomic with the initial `eventSeq=0`
   * counter. Idempotent: if the session already exists it is returned unchanged.
   */
  async function createSession({ sessionId, userId }) {
    const ref = sessionDocRef(sessionId);
    const nowMs = clock();
    return transactionRun(async (t) => {
      const existing = await t.get(ref);
      if (existing.exists) {
        return existing.data();
      }
      const data = {
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

  /**
   * Reads a session doc. Returns `null` when it does not exist.
   */
  async function getSession(sessionId) {
    const snap = await sessionDocRef(sessionId).get();
    return snap.exists ? snap.data() : null;
  }

  /**
   * Closes a session (status -> closed) and clears its Firestore TTL so the
   * document no longer auto-expires. Idempotent; throws SessionNotFoundError
   * if the session does not exist.
   */
  async function closeSession(sessionId) {
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

  /**
   * Touches a session to keep the TTL rolling and updates `lastEventId`. If the
   * session is closed, throws SessionClosedError.
   */
  async function extendSession(sessionId, lastEventId = null) {
    const ref = sessionDocRef(sessionId);
    return transactionRun(async (t) => {
      const existing = await t.get(ref);
      if (!existing.exists) throw new SessionNotFoundError(sessionId);
      if (existing.data().status !== SESSION_STATUS.ACTIVE) {
        throw new SessionClosedError(sessionId);
      }
      const patch = { updatedAt: clock() };
      if (lastEventId != null) patch.lastEventId = lastEventId;
      t.update(ref, patch);
      return { sessionId };
    });
  }

  /**
   * Appends a single event to a session.
   *
   * Validates `type` and `payload`, bumps `eventSeq` atomically, largest event id
   * = transaction seq. Refuses closed sessions.
   */
  async function appendEvent(sessionId, { type, payload }) {
    const ids = await appendEvents(sessionId, [{ type, payload }]);
    return ids[0];
  }

  async function appendEvents(sessionId, events) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new InvalidEventError('appendEvents requires at least one event');
    }
    const sessionRef = sessionDocRef(sessionId);
    return transactionRun(async (t) => {
      const snap = await t.get(sessionRef);
      if (!snap.exists) throw new SessionNotFoundError(sessionId);
      const sess = snap.data();
      if (sess.status !== SESSION_STATUS.ACTIVE) {
        throw new SessionClosedError(sessionId);
      }

      let seq = sess.eventSeq ?? 0;
      const written = [];
      for (const ev of events) {
        validateEvent(ev.type, ev.payload);
        seq += 1;
        const id = String(seq).padStart(6, '0'); // stable, orderable string id
        t.set(eventsColRef(sessionId).doc(id), {
          sessionId,
          eventId: id,
          type: ev.type,
          payload: ev.payload,
          seq,
          ts: clock(),
        });
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

  /**
   * Lists events in ascending seq order strictly after `afterSeq`.
   * Returns `[]` when there is nothing after that point.
   */
  async function listEventsAfter(sessionId, afterSeq = NO_EVENT_ID) {
    const col = eventsColRef(sessionId);
    const q = col.orderBy('seq', 'asc').startAfter(afterSeq);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }

  /**
   * Persists (or mutates) a chat message under the session. `complete` defaults
   * to false so the client can append tokens; callers set it true when done.
   */
  async function persistMessage(sessionId, message) {
    const col = messagesColRef(sessionId);
    const msgId = message.id ?? `m-${clock()}`;
    const ref = col.doc(msgId);
    const data = {
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

  /** Reads a single message back. */
  async function getMessage(sessionId, msgId) {
    const snap = await messagesColRef(sessionId).doc(msgId).get();
    return snap.exists ? snap.data() : null;
  }

  /** Lists all messages for a session, oldest first. */
  async function listMessages(sessionId) {
    const snap = await messagesColRef(sessionId).orderBy('createdAt', 'asc').get();
    return snap.docs.map((d) => d.data());
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

function validateEvent(type, payload) {
  const allowed = Object.values(EVENT_TYPE);
  if (!allowed.includes(type)) {
    throw new InvalidEventError(`Unsupported event type "${type}"`);
  }
  if (payload === undefined || payload === null) {
    throw new InvalidEventError('Event payload is required');
  }
}