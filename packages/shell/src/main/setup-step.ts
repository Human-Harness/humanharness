import type { SetupOutput, SetupResult, SetupStep } from "@humanharness/protocol";
import type { EngineGuards } from "./engine-guards";
import { type HasNotice, requireNoticeForStep } from "./notice-policy";
import type { RunningSetup } from "./setup-runner";

export interface SetupStepDeps<Cmd> {
  guards: EngineGuards;
  hasNotice: HasNotice;
  /** The engine the app is set to. */
  currentEngine(): Promise<string | undefined>;
  /** A turn is starting or running. */
  isBusy(): boolean;
  quitting(): boolean;
  /** Finds the step's command (may take seconds: it asks the login shell); null when there is none. */
  command(): Promise<Cmd | null>;
  dropRuntime(): Promise<void>;
  /** Spawns the step's process. */
  spawn(cmd: Cmd): RunningSetup;
  output(o: SetupOutput): void;
}

/**
 * One install, update, sign-in or sign-out, from reserving the slot to its end event. A cancel that
 * arrives before the process starts (while the CLI is being found) ends the step without starting
 * it, and before the running engine is closed.
 */
export async function runSetupStep<Cmd>(d: SetupStepDeps<Cmd>, engineId: string, step: SetupStep): Promise<SetupResult> {
  if (d.quitting()) throw new Error("The app is closing");
  await requireNoticeForStep(engineId, step, d.hasNotice);
  // Only a logout or update of the engine in use touches the runtime and blocks turns.
  const current = (await d.currentEngine()) === engineId;
  // Reserve the slot synchronously after the read, so a second call can't slip in while this one starts.
  d.guards.beginSetup({ engineId, step, current }, d.isBusy);
  d.output({ kind: "start", engineId, step });
  let result: SetupResult = { ok: false };
  try {
    const cmd = await d.command();
    if (!cmd) return result;
    // Cancelled while the CLI was being found: nothing starts and the engine in use stays.
    if (d.guards.setupCancelled()) return (result = { ok: false, cancelled: true });
    // Quitting closes the runtime itself: don't close it a second time at once.
    if (d.quitting()) throw new Error("The app is closing");
    if (current && (step === "logout" || step === "update")) {
      // Turns are refused from beginSetup on; this re-check is a safety net before the runtime goes.
      if (d.isBusy()) throw new Error("A turn is running");
      await d.dropRuntime();
    }
    if (d.quitting()) throw new Error("The app is closing");
    if (d.guards.setupCancelled()) return (result = { ok: false, cancelled: true });
    const run = d.spawn(cmd);
    const ok = (await run.exit) === 0;
    result = { ok, ...(!ok && d.guards.setupCancelled() ? { cancelled: true } : {}), ...(!ok && run.timedOut() ? { timedOut: true } : {}) };
    return result;
  } finally {
    d.guards.endSetup();
    d.output({ kind: "end", engineId, step, ...result });
  }
}
