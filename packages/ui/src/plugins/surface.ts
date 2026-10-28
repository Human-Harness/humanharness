import { createContext, useMemo } from "react";
import type { HarnessClient, PluginSurfaceView } from "../client";
import { type LiveSource, useLive } from "./usePlugins";

/** The core's default panel slot: the Plugins section in the left side panel (plugins part 2, Decision 2). */
export const PLUGINS_SLOT = "plugins";
/** The core's default chip slot: the top bar, right after the usage meter. */
export const CHIPS_SLOT = "chips";

/** A panel someone asked to see (a chip, an attention item): `n` is bumped per ask, so the same one scrolls again. */
export interface PanelTarget {
  plugin: string;
  panel: string;
  focus?: string;
  n: number;
}

export interface PluginSurfaceContextValue {
  surface: PluginSurfaceView;
  client: HarnessClient;
  /** The panel last opened; its slot selects it, scrolls it into view and passes `focus` to its frame. */
  target: PanelTarget | null;
  open(plugin: string, panel: string, focus?: string): void;
}

/** Set by ChatView while main sends a surface; null elsewhere, and then `<PluginSlot>` draws nothing. */
export const PluginSurfaceContext = createContext<PluginSurfaceContextValue | null>(null);

/**
 * What the window draws for the running plugins (plugins part 2), live: one read, then main's pushes. Disabled (no
 * `state.plugins`): the client is never asked and the answer is null (D0).
 */
export function usePluginSurface(client: HarnessClient, enabled: boolean): PluginSurfaceView | null {
  const source = useMemo<LiveSource<PluginSurfaceView>>(
    () => ({ get: () => client.plugins.surface(), onChange: (l) => client.plugins.onSurface(l) }),
    [client],
  );
  return useLive(source, enabled);
}

/** The dev reload count of a plugin's frames; an own key only (a plugin id is never looked up on the prototype). */
export function reloadOf(surface: PluginSurfaceView, plugin: string): number {
  const n = Object.hasOwn(surface.reloads, plugin) ? surface.reloads[plugin] : 0;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Whether `target` names this panel. */
export function isTarget(target: PanelTarget | null, plugin: string, panel: string): target is PanelTarget {
  return target !== null && target.plugin === plugin && target.panel === panel;
}
