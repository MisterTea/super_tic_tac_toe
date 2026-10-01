export const TURN_MS = 60_000;
// The longest result sound is 740ms; leave time to read the board afterward.
export const RESULT_HOLD_MS = 3_500;
export const MOVE_ROUTING_MS = 1_200;
// Variance 0.5 seconds squared; reject negative waits and samples over five seconds.
export function humanDelay(rng: () => number = Math.random): number {
  for (;;) {
    const u = Math.max(Number.MIN_VALUE, rng());
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    const seconds = 2 + Math.sqrt(0.5) * z;
    if (seconds >= 0 && seconds <= 5) return seconds * 1000;
  }
}
export function remainingSeconds(deadline: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
