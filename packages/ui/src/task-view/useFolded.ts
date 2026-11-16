import { useEffect, useRef, useState } from "react";
import type { SearchIntent } from "../search/intent";
import { type PanelTarget, PLUGINS_SLOT } from "../plugins/surface";
import type { PluginSurfaceView } from "../client";
import { useOverlay } from "./useOverlay";

type RecordIntent = Extract<SearchIntent, { kind: "record" }>;

/**
 * The chat's folded overlays (task view one column): the path or Sidekick, one at a time, folded on a task switch.
 * Sidekick's overlay switches between its cards and the harness's side panel (`skView`). A plugin panel opened (a chip,
 * the rail's Plugins, search, the inbox) unfolds the overlay that holds it, once, as soon as the panel is there; a
 * harness record picked while its side view was folded goes after the render that mounts the view.
 */
export function useFolded(o: {
  taskKey: unknown;
  /** Sidekick's overlay can show (a Sidekick, a wide window, not slim). */
  skShown: boolean;
  panelTarget: PanelTarget | null;
  surface: PluginSurfaceView | null;
  openRecord: (intent: RecordIntent) => void;
}) {
  const overlay = useOverlay(o.taskKey);
  const [skView, setSkView] = useState<"sidekick" | "harness">("sidekick");
  /** A card opens Sidekick's cards without taking focus (the panel never takes focus on its own). */
  const showSk = () => {
    overlay.show("sidekick", false);
    setSkView("sidekick");
  };
  /** Unfolds the overlay that holds the harness's side panel. */
  const showHarness = () => {
    if (!o.skShown) return overlay.show("path", false);
    setSkView("harness");
    overlay.show("sidekick", false);
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
  return { overlay, skView, setSkView, showSk, holdRecord };
}
