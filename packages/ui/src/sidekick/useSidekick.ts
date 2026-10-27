import { useEffect, useState } from "react";
import type { HarnessClient, SidekickState } from "../client";

/**
 * Sidekick's state, live; null while loading, when disabled (no `state.sidekick`, slim mode) or when main has none.
 * A push that lands before the first load wins over it (the load may be older).
 */
export function useSidekick(client: HarnessClient, enabled: boolean): SidekickState | null {
  const [state, setState] = useState<SidekickState | null>(null);
  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    let live = true;
    const off = client.sidekick.onChange((s) => {
      if (live) setState(s);
    });
    client.sidekick.get().then(
      (s) => {
        if (live) setState((now) => now ?? s);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client, enabled]);
  return enabled ? state : null;
}
