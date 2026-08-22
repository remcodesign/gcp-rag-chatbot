/**
 * Session / event state — schema constants.
 *
 * Domain 2 (Stateless Session and Event State). These constants are the single
 * source of truth for the Firestore document model shared by every backend
 * instance, so any instance can read, write and resume a session by `sessionId`
 * — the fix for "instances hopping".
 */

/** Collection names (top-level). */
export const COLLECTIONS = Object.freeze({
  SESSIONS: 'sessions',
  CORPUS: 'corpus',
});

/** Sub-collection names nested under a session. */
export const SESSION_SUBCOLLECTIONS = Object.freeze({
  EVENTS: 'events',
  MESSAGES: 'messages',
});

/** Allowed `sessions/{id}.status` values. */
export const SESSION_STATUS = Object.freeze({
  ACTIVE: 'active',
  CLOSED: 'closed',
});

/** Allowed `events/{id}.type` values. */
export const EVENT_TYPE = Object.freeze({
  PROGRESS: 'progress',
  TOKEN: 'token',
  ERROR: 'error',
});

/** Allowed `messages/{id}.role` values. */
export const MESSAGE_ROLE = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
});

/** Default TTL for a session, in seconds (Firestore TTL field, see infra/firestore.tf). */
export const SESSION_TTL_SECONDS = Object.freeze({
  DEFAULT_SESSION: 60 * 60 * 24, // 24h idle expiry
});

/** Reserved event id for "no events yet" / start of stream. */
export const NO_EVENT_ID = 0;