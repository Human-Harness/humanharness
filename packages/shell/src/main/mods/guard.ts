export type Guarded<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Runs a mod's function: a throw, a rejection or running past `ms` is a failure the host counts, never a throw. */
export async function guarded<T>(fn: () => T | Promise<T>, ms: number): Promise<Guarded<Awaited<T>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Guarded<Awaited<T>>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: `timed out after ${ms} ms` }), ms);
  });
  const run = (async (): Promise<Guarded<Awaited<T>>> => {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return { ok: false, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
