import { PHASE_ID } from "@humanharness/harness-sdk";
import type { PhaseResult } from "@humanharness/protocol";

export interface SetPhaseDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  setPhase(to: string, task: string): { accepted: Promise<PhaseResult>; done: Promise<void> };
}

/**
 * The handler of `hh:setPhase` (task-phases spec §4.2). It answers with the acceptance as a value: a refusal's reason
 * survives Electron's IPC, which keeps only a thrown error's message. The change turn reaches the window as events after
 * `hh:taskTurn`; its failure is only logged here, so main never has an unhandled rejection.
 */
export function setPhaseHandler(d: SetPhaseDeps): (task: unknown, phase: unknown) => Promise<PhaseResult> {
  return async (task, phase) => {
    if (d.quitting()) throw new Error("The app is closing");
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
    if (typeof task !== "string" || !task || task.length > 100 || typeof phase !== "string" || !PHASE_ID.test(phase)) throw new Error("Invalid phase");
    const { accepted, done } = d.setPhase(phase, task);
    done.catch((err: unknown) => console.error("The phase change's turn failed", err));
    return accepted;
  };
}

/**
 * `hh:send`'s time box (task-phases spec §5): a length the action offers, or `null` (no limit) for an action that
 * offers a box at all. `offered` is the action's options; absent for an action without a box or no known action.
 */
export function timeBoxOffered(timeBox: unknown, offered: readonly number[] | undefined): timeBox is number | null {
  if (timeBox === null) return offered !== undefined;
  return typeof timeBox === "number" && (offered ?? []).includes(timeBox);
}
