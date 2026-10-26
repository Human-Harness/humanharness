import { MODE_ID } from "@humanharness/harness-sdk";
import type { ModeChoice, ModeResult } from "@humanharness/ui/client";

export interface ChooseModeDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  /** The id of the open task, or null. */
  openTask(): Promise<string | null>;
  /** `task`: the open task when the pick arrived; a pick that waits for a turn is refused once another task is open. */
  choose(mode: string, choice: ModeChoice, task: string): { accepted: Promise<ModeResult>; done: Promise<void> };
}

/**
 * The handler of `hh:chooseMode` (task-modes spec §5). It answers with the acceptance as a value: a refusal's reason
 * and tiers survive Electron's IPC, which keeps only a thrown error's message. The switch's turn reaches the window as
 * events; its failure is only logged here, so main never has an unhandled rejection.
 */
export function chooseModeHandler(d: ChooseModeDeps): (mode: unknown, choice: unknown) => Promise<ModeResult> {
  return async (mode, choice) => {
    if (d.quitting()) throw new Error("The app is closing");
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
    if (typeof mode !== "string" || !MODE_ID.test(mode)) throw new Error("Invalid mode");
    const below = typeof choice === "object" && choice !== null ? (choice as { belowTier?: unknown }).belowTier : undefined;
    if (below !== undefined && below !== "continue" && below !== "new-task") throw new Error("Invalid mode");
    // The task the pick is for is the one open now, before the pick waits for a running turn (spec §5.2).
    const task = await d.openTask();
    if (task === null) return { ok: false, reason: "no-task" };
    const { accepted, done } = d.choose(mode, below ? { belowTier: below } : {}, task);
    done.catch((err: unknown) => console.error("The mode switch's turn failed", err));
    return accepted;
  };
}
