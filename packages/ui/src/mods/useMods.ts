import { useEffect, useState } from "react";
import type { HarnessClient, ModReview, ModsView } from "../client";

export interface ModsState {
  view: ModsView | null;
  /** The first read was refused and no push came since. */
  failed: boolean;
  set(id: string, on: boolean): Promise<void>;
  /** Main shows the folder dialog: a review and its one-time token, why the folder isn't a mod, or null (cancelled). */
  review(): Promise<{ review: ModReview; token: string } | { problem: string } | null>;
  add(token: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Settings › Mods (minimal-core spec §4, §6), live: one read, then main's pushes (a push before the read wins). Each
 * action replaces the view with main's answer.
 */
export function useMods(client: HarnessClient): ModsState {
  const [view, setView] = useState<ModsView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let pushed = false;
    const off = client.mods.onChanged((v) => {
      pushed = true;
      if (!live) return;
      setView(v);
      setFailed(false);
    });
    client.mods.view().then(
      (v) => {
        if (live && !pushed) setView(v);
      },
      () => {
        if (live && !pushed) setFailed(true);
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [client]);
  return {
    view,
    failed,
    set: async (id, on) => setView(await client.mods.set(id, on)),
    review: () => client.mods.reviewLocal(),
    add: async (token) => setView(await client.mods.addLocal(token)),
    remove: async (id) => setView(await client.mods.removeLocal(id)),
  };
}
