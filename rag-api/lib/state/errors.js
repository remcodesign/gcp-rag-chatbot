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

/** Domain error thrown when an operation targets an unknown session. */
export class SessionNotFoundError extends Error {
  constructor(message = 'Session not found') {
    super(message);
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
  }
}

/** Domain error thrown when a write targets a closed session. */
export class SessionClosedError extends Error {
  constructor(message = 'Session is closed') {
    super(message);
    this.name = 'SessionClosedError';
    this.code = 'SESSION_CLOSED';
  }
}

/** Domain error thrown when an event payload fails validation. */
export class InvalidEventError extends Error {
  constructor(message = 'Invalid event') {
    super(message);
    this.name = 'InvalidEventError';
    this.code = 'INVALID_EVENT';
  }
}