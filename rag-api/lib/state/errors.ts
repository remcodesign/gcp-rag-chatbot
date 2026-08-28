/**
 * Domain errors thrown by the session store.
 *
 * Domain 2. Typed errors let callers branch on the failure class without
 * string-matching `code`.
 */

/** Domain error thrown when an operation targets an unknown session. */
export class SessionNotFoundError extends Error {
    readonly code = 'SESSION_NOT_FOUND';

    constructor(message = 'Session not found') {
        super(message);
        this.name = 'SessionNotFoundError';
    }
}

/** Domain error thrown when a write targets a closed session. */
export class SessionClosedError extends Error {
    readonly code = 'SESSION_CLOSED';

    constructor(message = 'Session is closed') {
        super(message);
        this.name = 'SessionClosedError';
    }
}

/** Domain error thrown when an event payload fails validation. */
export class InvalidEventError extends Error {
    readonly code = 'INVALID_EVENT';

    constructor(message = 'Invalid event') {
        super(message);
        this.name = 'InvalidEventError';
    }
}