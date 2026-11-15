/**
 * Speed limit that survives a loaded machine: runs `fn` three times and checks the
 * shortest span, so one slow run (CPU contention, GC) does not fail the test.
 * `fn` must be synchronous and safe to run three times. Returns the last run's result.
 */
export function expectFast<T>(fn: () => T, limitMs: number): T {
  let best = Infinity;
  let result!: T;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    result = fn();
    best = Math.min(best, performance.now() - start);
  }
  if (best >= limitMs) throw new Error(`expected best of 3 (${Math.round(best * 10) / 10} ms) under ${limitMs} ms`);
  return result;
}
