/**
 * Session / event state — schema constants.
 *
 * Domain 2 (Stateless Session and Event State). These constants are the single
 * source of truth for the Firestore document model shared by every backend
 * instance, so any instance can read, write and resume a session by `sessionId`
 * — the fix for "instances hopping".
 */

/** Collection names (top-level). */
export const COLLECTIONS = {
  SESSIONS: 'sessions',
  CORPUS: 'corpus',
} as const;

/** Sub-collection names nested under a session. */
export const SESSION_SUBCOLLECTIONS = {
  EVENTS: 'events',
  MESSAGES: 'messages',
} as const;

/** Allowed `sessions/{id}.status` values. */
export const SESSION_STATUS = {
  ACTIVE: 'active',
  CLOSED: 'closed',
} as const;

/** Allowed `events/{id}.type` values. */
export const EVENT_TYPE = {
  PROGRESS: 'progress',
  TOKEN: 'token',
  ERROR: 'error',
} as const;

/** Allowed `messages/{id}.role` values. */
export const MESSAGE_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const;

/** Default TTL for a session, in seconds (Firestore TTL field, see infra/firestore.tf). */
export const SESSION_TTL_SECONDS = {
  DEFAULT_SESSION: 60 * 60 * 24, // 24h idle expiry
} as const;

/** Reserved event id for "no events yet" / start of stream. */
export const NO_EVENT_ID = 0;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];
export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];
export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];