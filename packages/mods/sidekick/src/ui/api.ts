import type { HarnessClient } from "@humanharness/ui";
import type {
  SidekickApproveCheck,
  SidekickDraftDef,
  SidekickImportInput,
  SidekickImportResult,
  SidekickInScope,
  SidekickInfo,
  SidekickLearned,
  SidekickOriginal,
  SidekickOutcome,
  SidekickPick,
  SidekickPlaceAnswer,
  SidekickPreset,
  SidekickReview,
  SidekickSetResult,
  SidekickSettingsPatch,
  SidekickState,
  SidekickView,
} from "../types";

/** The mod's id: its channels are `mods.sidekick.<name>` (each a method below) and its state comes on `mods.sidekick.state`. */
const ID = "sidekick";

/** Every call, by its channel's name (main's `SIDEKICK_CHANNELS`, the same 26). */
export const SIDEKICK_CALLS = ["get", "set", "review", "cancelReview", "resolve", "mute", "unmute", "saveDecision", "learned", "forget", "forgetAll", "editLearned", "beforeApprove", "cancelApprove", "ask", "presets", "adoptPreset", "pickFiles", "importDraft", "checkOriginal", "saveSidekick", "list", "remove", "reorder", "scope", "setScope"] as const satisfies readonly Exclude<keyof SidekickApi, "onChange">[];

/** What Sidekick's ui asks its own main (sidekick spec §7): its state, settings and the pre-send review. */
export interface SidekickApi {
  get(): Promise<SidekickState | null>;
  set(patch: SidekickSettingsPatch): Promise<SidekickSetResult>;
  /**
   * Reviews the prompt before it goes out; the composer sends as typed unless a card comes back or it was cancelled.
   * `attached`: the send carries attachments or material (mutes the missing-context flag). `block`: the text is a
   * block answer's free text, its card marked `block`.
   */
  review(req: { text: string; force?: boolean; attached?: boolean; block?: boolean }): Promise<SidekickReview>;
  /** Stops a running review (⌘⏎ sends at once). */
  cancelReview(): Promise<void>;
  /** What the person did with a card; it leaves the panel. */
  resolve(cardId: string, outcome: SidekickOutcome): Promise<void>;
  /** "Don't flag …": mutes the card's kind for its sidekick at once, and remembers it as the person's (spec §6.3). */
  mute(cardId: string): Promise<void>;
  /** Undoes a mute (Settings). */
  unmute(sidekick: string, kind: string): Promise<void>;
  /** "Save as decision" on a repeated-ask heads-up: a note written as the person; the card goes. */
  saveDecision(cardId: string): Promise<{ ok: boolean; message?: string }>;
  /** What Sidekick learned (spec §6.4), both levels. */
  learned(): Promise<SidekickLearned[]>;
  /** "Forget this": deletes one learned item, as the person. */
  forget(id: string): Promise<void>;
  /** "Forget everything": deletes every learned item of both levels, the person's too. */
  forgetAll(): Promise<void>;
  /** Edits from the person: their items become `source: "person"` (learning never changes them again). */
  editLearned(changes: { id: string; text: string }[]): Promise<void>;
  /**
   * For the document-review flow: call before approving; on a card, show it next to Approve (approve anyway stays
   * possible). Never waits longer than the person's wait setting; any failure answers `approve`.
   */
  beforeApprove(doc: { title: string; text: string }): Promise<SidekickApproveCheck>;
  /** The approval was answered or withdrawn: a running before-approve check stops (its answer is `approve`). */
  cancelApprove(): Promise<void>;
  /**
   * For a harness UI with places (spec §2a.5): asks the sidekick on for `place` (a manifest place id) about `content`
   * (at most 4,000 characters). A short plain-text answer and who gave it, never a card; `{ ok: false }` when Sidekick
   * is off, no sidekick answers there, or anything fails. The harness shows the answer in its place.
   */
  ask(place: string, content: string): Promise<SidekickPlaceAnswer>;
  /** "Suggested by the harness" (spec §2a.7): the manifest's presets, each with whether the person adopted it. */
  presets(): Promise<SidekickPreset[]>;
  /** "Add <name>": the preset becomes one of the person's sidekicks, and the presets count as offered. */
  adoptPreset(name: string): Promise<void>;
  /**
   * "Choose files" for an import: the system picker's choice as a token and the files' names (null when cancelled).
   * The paths stay in the app; nothing is read yet. Pass the token to importDraft, once, soon (a newer pick replaces it).
   */
  pickFiles(): Promise<SidekickPick | null>;
  /**
   * An import (spec §2a.6): pasted text (at most 64 KB), a pick's files (its token) or a stored sidekick's own
   * files again ("Bring the changes": `original`), at most 4 plain-text files of 64 KB, never inside an engine's
   * settings folder, turned into a draft sidekick and what it knows. Nothing is saved: the preview's Save does that.
   * Works with Sidekick off once the engine notice was accepted.
   */
  importDraft(input: SidekickImportInput): Promise<SidekickImportResult>;
  /** Whether an imported sidekick's files changed since ("The original changed"); `none` when it wasn't imported from files. */
  checkOriginal(sidekickId: string): Promise<SidekickOriginal>;
  /**
   * Saves a sidekick as the person: new without `def.id`, else every field of that one is replaced (send the full
   * def, `source` too). `learned`: the import's items, written as the person's. A files `source` must come from an
   * import (or be the one it already has). Rejects when it can't be written.
   */
  saveSidekick(def: SidekickDraftDef & { id?: string }, learned?: { text: string; level: "you" | "harness" }[]): Promise<SidekickInfo>;
  /** The person's sidekicks by order (Settings › Sidekicks); the implicit default alone when none was written. */
  list(): Promise<SidekickView[]>;
  /** Removes a sidekick, as the person; the last one stays (`ok: false` with why). */
  remove(id: string): Promise<{ ok: boolean; message?: string }>;
  /** Orders the sidekicks as `ids` (the higher one speaks when two could). */
  reorder(ids: string[]): Promise<void>;
  /** "Sidekicks in this <scope>" (spec §2a.4): every sidekick by order, on or off in `scope`, and its purpose text there. */
  scope(scope: string): Promise<SidekickInScope[]>;
  /**
   * A sidekick in a scope, as the person: on or off and its purpose text there (at most 600 characters; none when
   * absent). Send the `places` it had, or they are dropped. `ok: false` with why (e.g. the sidekick was removed).
   */
  setScope(scope: string, sidekick: string, v: { on: boolean; purposeText?: string; places?: string[] }): Promise<{ ok: boolean; message?: string }>;
  onChange(listener: (state: SidekickState) => void): () => void;
}

/**
 * Sidekick's main, through the mod's own channels (the window's `mods.call`/`mods.on`, what the loader's
 * `ctx.call`/`ctx.on` use): each method is the channel of its name, its arguments sent as an array.
 */
export function sidekickApi(client: Pick<HarnessClient, "mods">): SidekickApi {
  const calls = Object.fromEntries(SIDEKICK_CALLS.map((name) => [name, (...args: unknown[]) => client.mods.call(ID, name, args)]));
  return { ...calls, onChange: (fn) => client.mods.on(ID, "state", (v) => fn(v as SidekickState)) } as SidekickApi;
}
