import { useEffect, useRef, useState } from "react";
import type { SearchIntent } from "../search/intent";
import { type PanelTarget, PLUGINS_SLOT } from "../plugins/surface";
import type { PluginSurfaceView } from "../client";
import { type OverlayName, useOverlay } from "./useOverlay";

type RecordIntent = Extract<SearchIntent, { kind: "record" }>;

/**
 * The chat's folded overlays (task view one column): the path or a mod's, one at a time, folded on a task switch. A
 * mod's overlay may hold the harness's side panel (`host`, `TaskViewValue.hostSide`), switching between its own view
 * and the harness's (`sideView`). A plugin panel opened (a chip, the rail's Plugins, search, the inbox) unfolds the
 * overlay that holds it, once, as soon as the panel is there; a harness record picked while its side view was folded
 * goes after the render that mounts the view.
 */
export function useFolded(o: {
  taskKey: unknown;
  /** The overlay that holds the harness's side panel, when a mod's does; else the path holds it. */
  host: OverlayName | null;
  panelTarget: PanelTarget | null;
  surface: PluginSurfaceView | null;
  openRecord: (intent: RecordIntent) => void;
}) {
  const overlay = useOverlay(o.taskKey);
  const [sideView, setSideView] = useState<"own" | "harness">("own");
  /** Unfolds the overlay that holds the harness's side panel. */
  const showHarness = () => {
    if (!o.host) return overlay.show("path", false);
    setSideView("harness");
    overlay.show(o.host, false);
  };
  const unfolded = useRef(0);
  const { panelTarget: target, surface } = o;
  useEffect(() => {
    const panel = target && surface?.panels.find((p) => p.plugin === target.plugin && p.id === target.panel);
    if (!panel || unfolded.current === target.n) return;
    unfolded.current = target.n;
    if (panel.slot !== PLUGINS_SLOT) showHarness();
    else overlay.show("path", false);
  }, [target, surface]);
  const pending = useRef<RecordIntent | null>(null);
  useEffect(() => {
    const intent = pending.current;
    pending.current = null;
    if (intent) o.openRecord(intent);
  });
  /** Holds a record for the harness's side view, unfolded for it. */
  const holdRecord = (intent: RecordIntent) => {
    pending.current = intent;
    showHarness();
  };
  return { overlay, sideView, setSideView, holdRecord };
}
