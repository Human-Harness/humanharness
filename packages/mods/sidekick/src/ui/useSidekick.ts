import { useEffect, useState } from "react";
import type { HarnessClient } from "@humanharness/ui";
import type { SidekickState } from "../types";
import { sidekickApi } from "./api";

/**
 * Sidekick's state, live; null while loading, when disabled (no `state.sidekick`, slim mode) or when main has none.
 * A push that lands before a load wins over it (the load may be older). A new `refresh` reads it again (after a
 * restore; main's `SidekickController.refresh()` pushes then too, and this read is a fallback).
 */
export function useSidekick(client: HarnessClient, enabled: boolean, refresh = 0): SidekickState | null {
  const [state, setState] = useState<SidekickState | null>(null);
  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    let live = true;
    let pushed = false;
    const off = sidekickApi(client).onChange((s) => {
      pushed = true;
      if (live) setState(s);
    });
    sidekickApi(client).get().then(
      (s) => {
        if (live && !pushed) setState((now) => s ?? now);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [client, enabled, refresh]);
  return enabled ? state : null;
}
