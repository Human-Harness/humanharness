import { useRef } from "react";

/**
 * A nested config value (Settings › General's `parallel`, Settings › Jobs' `jobs`) that a save sends whole: main merges
 * only the top level, so each patch must be built on the one before it, not on the render's props, which lag behind a
 * save still in flight. `get` answers the latest value asked for; `save` records `next` and runs the save. Once no save
 * is in flight the next render's props win again (main's cleaned copy); a failed save's value is dropped at once.
 */
export function useLatestConfig<T>(value: T): { get(): T; save<R>(next: T, run: (next: T) => Promise<R>): Promise<R> } {
  const latest = useRef(value);
  const shown = useRef(value);
  const pending = useRef(0);
  shown.current = value;
  if (pending.current === 0) latest.current = value;
  return {
    get: () => latest.current,
    save: (next, run) => {
      latest.current = next;
      pending.current += 1;
      return run(next).then(
        (r) => {
          pending.current -= 1;
          return r;
        },
        (e: unknown) => {
          pending.current -= 1;
          if (pending.current === 0) latest.current = shown.current;
          throw e;
        },
      );
    },
  };
}
