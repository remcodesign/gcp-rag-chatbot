/**
 * Domain 2 — Stateless Session and Event State (Firestore).
 *
 * Public entry point for the state module. Callers get the bound `createStateStore`
 * factory plus the schema constants and error types.
 */

export { createStateStore } from './sessionStore.js';
export * from './constants.js';
export * from './errors.js';