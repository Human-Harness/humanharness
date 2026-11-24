import { type ReactNode, createContext, useContext } from "react";
import type { AppState, HarnessClient } from "../client";
import type { OverlayName } from "./useOverlay";

/**
 * The open task view, as a core mod's task-view pieces (`ctx.taskBar`, `ctx.taskOverlay`, `ctx.composer`) see it: the
 * draft and the sends, the right overlay, the harness's side panel and the live region. Provided by the chat around
 * everything it draws, the task bar's portal included.
 */
export interface TaskViewValue {
  client: HarnessClient;
  state: AppState;
  /** The open task's id; null with none open. */
  task: string | null;
  /** Slim mode (no task view pieces at all). */
  slim: boolean;
  /** A window too narrow for the right overlay (and for a review the person can't see). */
  narrow: boolean;
  /** "⌘" on macOS, "Ctrl" elsewhere: the key that sends at once. */
  sendKey: string;
  draft: string;
  setDraft(text: string): void;
  focusComposer(): void;
  /** Sends `text` as the person's message, unreviewed; false when it can't go now (nothing went). */
  send(text: string): boolean;
  /** Starts the task's closing turn; false when it can't start now. */
  finishTask(): boolean;
  /** Whether material in the open scope goes with the prompt. */
  attached(): Promise<boolean>;
  /** The harness's side panel, when it has one. */
  harnessSide: ReactNode | undefined;
  /** Which view the overlay that hosts the harness's side panel shows. */
  sideView: "own" | "harness";
  setSideView(view: "own" | "harness"): void;
  /** Says which mod overlay holds the harness's side panel (none: the path does). */
  hostSide(overlay: OverlayName | null): void;
  /** The right overlays: which is open, and opening or folding one. `show(name, false)` keeps focus where it is. */
  overlay: { open: OverlayName | null; show(name: OverlayName, focus?: boolean): void; hide(): void; close(): void };
  /** A mod overlay's name, as `overlay` takes it. */
  overlayName(mod: string, name: string): OverlayName;
  /** Says `text` in the chat's polite live region (once, even when the same words come again). */
  announce(text: string): void;
  /** Bumped after a restore: pieces that read state read it again. */
  refresh: number;
}

export const TaskViewContext = createContext<TaskViewValue | null>(null);

/** The open task view; throws outside the chat (a mod's task-view piece is only drawn inside it). */
export function useTaskView(): TaskViewValue {
  const v = useContext(TaskViewContext);
  if (!v) throw new Error("useTaskView outside the task view");
  return v;
}
