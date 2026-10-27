import { BLOCK_ID, type RespondResult } from "@humanharness/harness-sdk";

export interface RespondDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  respond(blockId: string, value: Record<string, unknown>): { accepted: Promise<RespondResult>; done: Promise<void> };
}

/**
 * The handler of `hh:respond` (input-blocks spec §4). It answers with the acceptance as a value: a refusal's field
 * errors survive Electron's IPC, which keeps only a thrown error's message. The turn after it reaches the window
 * as events; its failure is only logged here, so main never has an unhandled rejection.
 */
export function respondHandler(d: RespondDeps): (blockId: unknown, value: unknown) => Promise<RespondResult> {
  return async (blockId, value) => {
    if (d.quitting()) throw new Error("The app is closing");
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
    if (typeof blockId !== "string" || !BLOCK_ID.test(blockId)) throw new Error("Invalid answer");
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid answer");
    const { accepted, done } = d.respond(blockId, value as Record<string, unknown>);
    done.catch((err: unknown) => console.error("The answer's turn failed", err));
    return accepted;
  };
}
