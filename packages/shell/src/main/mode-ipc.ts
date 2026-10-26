import { MODE_ID } from "@humanharness/harness-sdk";
import type { ModeChoice, ModeResult } from "@humanharness/ui/client";

export interface ChooseModeDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  choose(mode: string, choice: ModeChoice): { accepted: Promise<ModeResult>; done: Promise<void> };
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
    const { accepted, done } = d.choose(mode, below ? { belowTier: below } : {});
    done.catch((err: unknown) => console.error("The mode switch's turn failed", err));
    return accepted;
  };
}
