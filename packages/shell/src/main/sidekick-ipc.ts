import type { SidekickOutcome, SidekickReview, SidekickSetResult, SidekickState } from "@humanharness/ui/client";
import type { SidekickController } from "./sidekick";

const OUTCOMES: readonly SidekickOutcome[] = ["used", "edited", "sent-anyway", "dismissed"];
const MAX_PROMPT = 20_000;

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;
type Ctl = Pick<SidekickController, "state" | "set" | "review" | "cancel" | "resolve" | "mute" | "unmute">;
const MAX_ID = 80;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;

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
}
