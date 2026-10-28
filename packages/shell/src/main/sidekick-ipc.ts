import { isAbsolute } from "node:path";
import type { SidekickApproveCheck, SidekickImportInput, SidekickImportResult, SidekickLearned, SidekickOriginal, SidekickOutcome, SidekickPlaceAnswer, SidekickPreset, SidekickReview, SidekickSetResult, SidekickState } from "@humanharness/ui/client";
import type { SidekickController } from "./sidekick";
import { IMPORT_MAX_BYTES, IMPORT_MAX_FILES } from "./sidekick-import";
import { SIDEKICK_PLACE_INPUT_MAX } from "./sidekick-turns";

const OUTCOMES: readonly SidekickOutcome[] = ["used", "edited", "sent-anyway", "dismissed"];
const MAX_PROMPT = 20_000;
/** A document checked before approval: its title and text. */
const MAX_TITLE = 200;
const MAX_DOC = 200_000;
const APPROVE: SidekickApproveCheck = { kind: "approve" };
/** A harness place's id (the manifest's place-id pattern) and the answer to anything malformed. */
const PLACE = /^[a-z][a-z0-9_-]{0,63}$/;
const NO_ANSWER: SidekickPlaceAnswer = { ok: false };
/** A preset's name (the manifest's bound). */
const MAX_PRESET_NAME = 40;
/** An import's picked path (the import source schema's bound). */
const MAX_PATH = 1024;
const IMPORT_FAILED: SidekickImportResult = { ok: false, reason: "failed" };

/** An import request: pasted text (at most IMPORT_MAX_BYTES characters; the controller counts bytes) or 1..4 absolute paths. */
function importInput(v: unknown): SidekickImportInput | null {
  if (typeof v !== "object" || v === null) return null;
  const { kind, text, paths } = v as { kind?: unknown; text?: unknown; paths?: unknown };
  if (kind === "paste") return typeof text === "string" && text.length <= IMPORT_MAX_BYTES ? { kind, text } : null;
  if (kind !== "files" || !Array.isArray(paths) || paths.length === 0 || paths.length > IMPORT_MAX_FILES) return null;
  const ok = paths.every((p: unknown) => typeof p === "string" && p.length > 0 && p.length <= MAX_PATH && !p.includes("\0") && isAbsolute(p));
  return ok ? { kind, paths: [...(paths as string[])] } : null;
}

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;
type Ctl = Pick<SidekickController, "state" | "set" | "review" | "cancel" | "resolve" | "mute" | "unmute" | "saveDecision" | "learned" | "forget" | "forgetAll" | "editLearned" | "beforeApprove" | "cancelApprove" | "ask" | "presets" | "adoptPreset" | "pickFiles" | "importDraft" | "checkSidekick">;
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
  // Before approve (spec §2a.2): a malformed document never reaches the controller, and approval goes ahead.
  handle("hh:sidekickBeforeApprove", async (doc: unknown): Promise<SidekickApproveCheck> => {
    const c = ctl();
    if (!c || typeof doc !== "object" || doc === null) return APPROVE;
    const { title, text } = doc as { title?: unknown; text?: unknown };
    if (typeof title !== "string" || title.length > MAX_TITLE) return APPROVE;
    if (typeof text !== "string" || !text.trim() || text.length > MAX_DOC) return APPROVE;
    return c.beforeApprove({ title, text }).catch(() => APPROVE);
  });
  handle("hh:sidekickApproveCancel", () => ctl()?.cancelApprove());
  // A harness place (spec §2a.5): the harness UI's input is bounded here; anything malformed never reaches the controller.
  handle("hh:sidekickAsk", async (place: unknown, content: unknown): Promise<SidekickPlaceAnswer> => {
    const c = ctl();
    if (!c || typeof place !== "string" || !PLACE.test(place)) return NO_ANSWER;
    if (typeof content !== "string" || !content.trim() || content.length > SIDEKICK_PLACE_INPUT_MAX) return NO_ANSWER;
    return c.ask(place, content).catch(() => NO_ANSWER);
  });
  // Presets (spec §2a.7): listed even with Sidekick off; adopting writes as the person.
  handle("hh:sidekickPresets", async (): Promise<SidekickPreset[]> => (await ctl()?.presets().catch(() => [])) ?? []);
  handle("hh:sidekickAdoptPreset", async (name: unknown) => {
    if (typeof name !== "string" || !name || name.length > MAX_PRESET_NAME) return;
    await ctl()?.adoptPreset(name);
  });
  // Import (spec §2a.6): the picker only returns paths; files are refused and read in main, never by the renderer.
  handle("hh:sidekickPickFiles", async (): Promise<string[]> => (await ctl()?.pickFiles().catch(() => [])) ?? []);
  handle("hh:sidekickImportDraft", async (input: unknown): Promise<SidekickImportResult> => {
    const c = ctl();
    const req = importInput(input);
    if (!c || !req) return IMPORT_FAILED;
    return c.importDraft(req).catch(() => IMPORT_FAILED);
  });
  // By the sidekick's id: the paths checked are the stored ones, never the renderer's.
  handle("hh:sidekickCheckOriginal", async (id: unknown): Promise<SidekickOriginal> => {
    const c = ctl();
    if (!c || !isId(id)) return "none";
    return c.checkSidekick(id).catch(() => "none" as const);
  });
  handle("hh:sidekickEditLearned", async (changes: unknown) => {
    if (!isEdits(changes)) return;
    await ctl()?.editLearned(changes.map(({ id, text }) => ({ id, text: text.trim() })));
  });
}
