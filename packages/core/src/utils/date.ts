/**
 * Format a Date as ISO date string (yyyy-MM-dd).
 */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Format a Date as ISO datetime string (yyyy-MM-ddTHH:mm:ss).
 */
export function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}
