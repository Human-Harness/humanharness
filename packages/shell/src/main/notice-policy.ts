import type { SetupStep } from "@humanharness/protocol";
import { EngineUnavailable } from "./turn-controller";

/** Whether the engine's legal notice is accepted at the current version. */
export type HasNotice = (engineId: string) => Promise<boolean>;

const NOT_ACCEPTED = "The engine's notice has not been accepted";

/** Every turn (spec §9): the notice may have been reset (Start over) while a runtime runs. */
export async function requireNoticeForTurn(engineId: string | undefined, hasNotice: HasNotice): Promise<void> {
  if (engineId && !(await hasNotice(engineId))) throw new EngineUnavailable("notice-required");
}

/** Onboarding starts with the notice, so only signing out runs without it. */
export async function requireNoticeForStep(engineId: string, step: SetupStep, hasNotice: HasNotice): Promise<void> {
  if (step !== "logout" && !(await hasNotice(engineId))) throw new Error(NOT_ACCEPTED);
}

/** An engine is only chosen once its notice is accepted. */
export async function requireNoticeForChoice(chosen: string | undefined, current: string | undefined, hasNotice: HasNotice): Promise<void> {
  if (chosen && chosen !== current && !(await hasNotice(chosen))) throw new Error(NOT_ACCEPTED);
}
