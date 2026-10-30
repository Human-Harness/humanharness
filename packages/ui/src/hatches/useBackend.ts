import { useCallback, useEffect, useState } from "react";
import type { BackendState, HarnessClient } from "../client";

export interface UseBackend {
  /** null until main answers (or for a harness without a backend, where it never does). */
  state: BackendState | null;
  /** `client.backend.call`: rejects with the backend's message, a timeout or "The backend isn't running". */
  call: (method: string, params?: unknown) => Promise<unknown>;
  /** `client.backend.on`: returns the unsubscribe, so it fits a `useEffect`. */
  on: (event: string, listener: (data: unknown) => void) => () => void;
}

/** The harness's backend for a harness view (hatches spec §4): its state kept fresh, `call` and `on`. */
export function useBackend(client: HarnessClient): UseBackend {
  const [state, setState] = useState<BackendState | null>(null);
  useEffect(() => {
    let live = true;
    // A change that has arrived is newer than the first answer, which may have been in flight before it.
    let seen = false;
    const off = client.backend.onState((s) => {
      seen = true;
      if (live) setState(s);
    });
    client.backend.state().then(
      (s) => {
        if (live && !seen) setState(s);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client]);
  const call = useCallback((method: string, params?: unknown) => client.backend.call(method, params), [client]);
  const on = useCallback((event: string, listener: (data: unknown) => void) => client.backend.on(event, listener), [client]);
  return { state, call, on };
}
