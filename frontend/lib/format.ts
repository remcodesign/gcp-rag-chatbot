/**
 * Small display-formatting helpers shared across chat components.
 */

/**
 * Formats an epoch-ms timestamp as `HH:MM` (local).
 *
 * @param ts epoch milliseconds.
 * @returns a `HH:MM` string in the local timezone.
 */
export function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
