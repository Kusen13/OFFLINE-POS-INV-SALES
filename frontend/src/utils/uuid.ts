/**
 * UUID generation utility
 * Uses the browser's built-in crypto.randomUUID()
 */

export function generateUUID(): string {
  return crypto.randomUUID();
}
