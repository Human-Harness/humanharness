import { useEffect, useMemo, useState } from "react";
import type { AttentionView, HarnessClient, PluginsView } from "../client";

interface LiveSource<V> {
  get(): Promise<V | null>;
  onChange(listener: (view: V) => void): () => void;
}
/**
 * Keeps a view live: one read when `enabled`, then main's pushes. A push that lands before the read wins over it
 * (the read may be older). Disabled (no `state.plugins`): nothing is asked or subscribed, and the answer is null (D0).
 * `failed`: the read was refused or answered nothing, and no push came since.
 */
function useLiveState<V>(source: LiveSource<V>, enabled: boolean): { view: V | null; failed: boolean } {
  const [view, setView] = useState<V | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!enabled) {
      setView(null);
      return;
    }
    let live = true;
    let pushed = false;
    const off = source.onChange((v) => {
      pushed = true;
      if (!live) return;
      setView(v);
      setFailed(false);
    });
    source.get().then(
      (v) => {
        if (!live || pushed) return;
        setView(v);
        setFailed(v === null);
      },
      () => {
        if (live && !pushed) setFailed(true);
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [source, enabled]);
  return enabled ? { view, failed } : { view: null, failed: false };
}
function useLive<V>(source: LiveSource<V>, enabled: boolean): V | null {
  return useLiveState(source, enabled).view;
}

/** The Attention inbox (plugins spec §6), live; null while loading or without plugins. */
export function useAttention(client: HarnessClient, enabled: boolean): AttentionView | null {
  return useLive(client.attention, enabled);
}

/** Settings › Plugins (plugins spec §7), live; null while loading or without plugins. */
export function usePluginsView(client: HarnessClient, enabled: boolean): PluginsView | null {
  return useLive(client.plugins, enabled);
}

/**
 * Settings › Plugins (plugins spec §7): the tab opening is when changes on disk are looked for, so its first read is a
 * rescan; main's pushes follow.
 */
export function usePluginsRescan(client: HarnessClient): { view: PluginsView | null; failed: boolean } {
  const source = useMemo<LiveSource<PluginsView>>(() => ({ get: () => client.plugins.rescan(), onChange: (l) => client.plugins.onChange(l) }), [client]);
  return useLiveState(source, true);
}
