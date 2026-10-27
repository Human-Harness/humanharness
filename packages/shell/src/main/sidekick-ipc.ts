import type { SidekickLearned, SidekickOutcome, SidekickReview, SidekickSetResult, SidekickState } from "@humanharness/ui/client";
import type { SidekickController } from "./sidekick";

const OUTCOMES: readonly SidekickOutcome[] = ["used", "edited", "sent-anyway", "dismissed"];
const MAX_PROMPT = 20_000;

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;
type Ctl = Pick<SidekickController, "state" | "set" | "review" | "cancel" | "resolve" | "mute" | "unmute" | "saveDecision" | "learned" | "forget" | "forgetAll" | "editLearned">;
const MAX_ID = 80;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
/** Edits to the learned items: at most MAX_EDITS, each an id and a text of 1..MAX_LEARNED characters (not blank). */
const MAX_EDITS = 50;
const MAX_LEARNED = 300;
const isEdits = (v: unknown): v is { id: string; text: string }[] =>
  Array.isArray(v) &&
  v.length <= MAX_EDITS &&
  v.every((c: unknown) => {
    if (typeof c !== "object" || c === null) return false;
    const { id, text } = c as { id?: unknown; text?: unknown };
    return isId(id) && typeof text === "string" && text.trim().length > 0 && text.length <= MAX_LEARNED;
  });

/** Sidekick's channels (sidekick spec §7). A malformed request never reaches the controller; a bad review sends as typed. */
export function registerSidekickIpc(handle: Handle, ctl: () => Ctl | null): void {
  handle("hh:sidekickGet", async (): Promise<SidekickState | null> => (await ctl()?.state()) ?? null);
  handle("hh:sidekickSet", async (patch: unknown): Promise<SidekickSetResult> => {
    const c = ctl();
    if (!c) return { ok: false, message: "Sidekick is not available" };
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return { ok: false, message: "A Sidekick change must be an object" };
    return c.set(patch as never);
  });
  handle("hh:sidekickReview", async (req: unknown): Promise<SidekickReview> => {
    const c = ctl();
    if (!c || typeof req !== "object" || req === null) return { kind: "send" };
    const { text, force, attached } = req as { text?: unknown; force?: unknown; attached?: unknown };
    if (typeof text !== "string" || !text.trim() || text.length > MAX_PROMPT) return { kind: "send" };
    return c.review({ text, ...(force === true ? { force: true } : {}), ...(attached === true ? { attached: true } : {}) });
  });
  handle("hh:sidekickCancel", () => ctl()?.cancel());
  handle("hh:sidekickResolve", async (id: unknown, outcome: unknown) => {
    if (typeof id !== "string" || !OUTCOMES.includes(outcome as SidekickOutcome)) return;
    await ctl()?.resolve(id, outcome as SidekickOutcome);
  });
  handle("hh:sidekickMute", async (id: unknown) => {
    if (!isId(id)) return;
    await ctl()?.mute(id);
  });
  handle("hh:sidekickUnmute", async (sidekick: unknown, kind: unknown) => {
    if (!isId(sidekick) || !isId(kind)) return;
    await ctl()?.unmute(sidekick, kind);
  });
  handle("hh:sidekickSaveDecision", async (id: unknown): Promise<{ ok: boolean; message?: string }> => {
    const c = ctl();
    if (!c) return { ok: false, message: "Sidekick is not available" };
    if (!isId(id)) return { ok: false, message: "Not a Sidekick card" };
    return c.saveDecision(id);
  });
  // What Sidekick learned (spec §6.4): written as the person; a malformed request never reaches the controller.
  handle("hh:sidekickLearned", async (): Promise<SidekickLearned[]> => (await ctl()?.learned()) ?? []);
  handle("hh:sidekickForget", async (id: unknown) => {
    if (!isId(id)) return;
    await ctl()?.forget(id);
  });
  handle("hh:sidekickForgetAll", async () => {
    await ctl()?.forgetAll();
  });
  handle("hh:sidekickEditLearned", async (changes: unknown) => {
    if (!isEdits(changes)) return;
    await ctl()?.editLearned(changes.map(({ id, text }) => ({ id, text: text.trim() })));
  });
}
