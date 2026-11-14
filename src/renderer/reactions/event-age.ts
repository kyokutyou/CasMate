// Small sender/renderer wall-clock differences must not discard fresh events.
export function reactionEventAge(at: number, now = Date.now()): number | null {
  const age = now - at;
  return Number.isFinite(age) && age >= -100 ? Math.max(0, age) : null;
}
