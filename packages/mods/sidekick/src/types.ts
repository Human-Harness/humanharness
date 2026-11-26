import type { PhaseMovedInfo, TurnEndInfo } from "@humanharness/mod-sdk";

/**
 * A turn that ended, as the controller reads it: the mod's `turnEnd` payload and the turn's kind (`run` for the
 * person's own turns; `close`, `checkpoint`, `wrap-up`… otherwise). Only a `run` turn gets an after-reply.
 */
export type TurnEnd = TurnEndInfo & { kind: string };
/** A task's phase moved: the mod's `phaseMoved` payload. */
export type PhaseMoved = PhaseMovedInfo;

// The window's view of Sidekick (sidekick spec), moved from the protocol: only the mod's main and ui use it.
/** The sidekick that speaks. Part 1's one: `{ id: "sidekick", name: "Sidekick", mark: "coach" }`. */
export interface SidekickInfo {
  id: string;
  name: string;
  /** Its mark: an icon name of the set (style guide §4); anything else reads as `coach`. */
  mark: string;
}

export interface SidekickSettings {
  on: boolean;
  /** The pre-send moment (spec §8 "the three moments, each on its own"). */
  preSend: boolean;
  /** Longest wait before the prompt goes out as typed, in seconds; "always" waits up to 60 s. */
  wait: 6 | 10 | "always";
  /** Sidekick's tokens per task. */
  cap: 20_000 | 50_000 | "none";
  /** The off-state intro was answered. */
  introSeen: boolean;
  /** The after-reply moment (spec §4.2). */
  afterReply: boolean;
  /** The heads-ups (spec §4.3). */
  headsUps: boolean;
  /** The harness's presets were offered once (spec §2a.7). */
  presetsOffered: boolean;
  /** Muted kinds per sidekick id (spec §6.3). */
  muted: Record<string, string[]>;
  /** The newest event the last learning turn read (spec §6.4); absent until it first ran. */
  learnedAt?: string;
  /** The day of the last daily card (YYYY-MM-DD); absent until the first one. */
  lastDaily?: string;
}

/** An item of "What Sidekick learned" (spec §6.4). `person`: written or edited by the person; learning never changes it. */
export interface SidekickLearned {
  id: string;
  text: string;
  level: "you" | "harness";
  source: "learned" | "person";
  kind?: string;
}
export type SidekickSettingsPatch = Partial<SidekickSettings>;
export type SidekickSetResult = { ok: true; settings: SidekickSettings } | { ok: false; message: string };

export type SidekickFlagKind = "vague" | "missing-context" | "two-asks" | "off-phase";
export interface SidekickFlagView {
  kind: SidekickFlagKind;
  match: string;
  span: [number, number];
}
export interface SidekickIssue {
  kind: SidekickFlagKind | "other";
  text: string;
  span?: [number, number];
}

/** A suggestion (spec §4.1 step 4). */
export interface SidekickCard {
  id: string;
  /** The prompt as typed. */
  prompt: string;
  /** About a block answer's free text (spec §4.1): its Send anyway sends the form, not the composer. */
  block?: true;
  flags: SidekickFlagView[];
  issues: SidekickIssue[];
  rewrite?: string;
  queued?: string[];
  confidence: number;
  at: string;
  /** Which moment it belongs to; and who speaks (spec §7 "every card names who speaks"). */
  moment: SidekickCardMoment;
  speaker: SidekickInfo;
  /** The kind its threshold and muting use: the first issue's (or flag's) kind; "gap", "next"… for other moments. */
  kind: string;
  /** "You took N of your last M <kind> suggestions" (spec §4.1 step 4); absent with fewer than 3. */
  why?: { used: number; of: number };
  /** After the reply (spec §4.2): a gap, the next prompt (Put in composer), a repeated ask; a mentor's lesson ("Worth knowing"). */
  after?: { gap?: { title: string; text: string }; next?: string; repeated?: { topic: string; decision: string }; lesson?: string };
  /** A process-guard's card (spec §2a.2): what the phase left (or the document) is missing. */
  guard?: { missing: string[] };
  /** The daily card (spec §2a.2 daily-summary): yesterday in a few plain sentences. */
  text?: string;
  /** A heads-up (spec §4.3): the context near full, an ask that keeps coming back, prompts drifting off the phase. */
  headsUp?: SidekickHeadsUp;
}

/** Context near full → Finish task; a repeated ask → Save as decision; off-phase drift → Finish task (plan Decision 7). */
export type SidekickHeadsUp = { kind: "context"; share: number } | { kind: "repeated"; topic: string; decision: string } | { kind: "off-phase"; phase?: string };

export type SidekickCardMoment = "pre" | "after" | "heads-up" | "before-approve" | "phase-change" | "daily" | "place";

/** Off · Watching · Reading your prompt… · Has a suggestion · Past its cap (spec §7). */
export type SidekickStatus = "off" | "watching" | "reading" | "suggestion" | "capped";

export interface SidekickState {
  info: SidekickInfo;
  settings: SidekickSettings;
  status: SidekickStatus;
  /** Tokens toward the cap in the open task (input + output + cache writes). */
  spent: number;
  /** The cap in tokens; null for no cap. */
  cap: number | null;
  /** The tier Sidekick's turns run at (Settings › Models), or "custom". */
  tier: string;
  card: SidekickCard | null;
  /** The open task's waiting cards other than the live pre-send one (after the reply). */
  cards: SidekickCard[];
  /** Sidekick's tokens in the last 7 days. */
  week: number;
  /** The last review could not finish: the prompt went as typed (spec §5 "Errors"). */
  notice?: "failed" | "timeout";
  /** The current task's earlier cards, one line each ("Earlier · used"). */
  past: { id: string; kind: string; outcome: SidekickOutcome | "muted" | "timeout"; speaker: string }[];
  /** "N of M suggestions used" over the last 7 days (spec §8). */
  used: { used: number; of: number };
  /** The person's sidekicks by order (Settings names the tab "Sidekicks" with two or more); absent from older mains. */
  sidekicks?: SidekickInfo[];
  /** The harness's places (spec §2a.5), for a custom purpose's moments; absent when it has none. */
  places?: { id: string; label: string }[];
}

/**
 * What the composer does with a review: `send` the prompt as typed (no flags, a clean verdict, Sidekick off or past
 * its cap), show the `card`, send as typed after a `timeout` or an `error`, or nothing (`cancelled`: the person
 * sent at once or the review was replaced).
 */
export type SidekickReview = { kind: "send" } | { kind: "card"; card: SidekickCard } | { kind: "timeout" } | { kind: "error" } | { kind: "cancelled" };
/** What the document-review flow does before approving (spec §2a.2): approve, or show the card next to Approve. */
export type SidekickApproveCheck = { kind: "approve" } | { kind: "card"; card: SidekickCard };
/** A harness place's answer (spec §2a.5, plan Decision 13): free text, at most 600 characters. */
export type SidekickPlaceAnswer = { ok: true; text: string; speaker: SidekickInfo } | { ok: false };
/** A sidekick's purpose as the UI shows it: a core purpose id, or `custom` with its text and moments. */
export interface SidekickPurposeView {
  id: string;
  text?: string;
  moments?: string[];
}
/** A ready-made sidekick the harness offers (spec §2a.7); `adopted` once the person added it. */
export interface SidekickPreset {
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeView[];
  adopted: boolean;
}
/** Where an imported sidekick came from: pasted text, or files with the hash of what was read. */
export type SidekickSource = { kind: "paste" } | { kind: "files"; paths: string[]; hash: string; tag?: string };
export type SidekickImportInput = { kind: "paste"; text: string } | { kind: "files"; token: string } | { kind: "original"; sidekickId: string };
/** A pick for an import: a token for the paths the app kept (used once by importDraft) and the files' names to show. */
export interface SidekickPick {
  token: string;
  files: string[];
}
/** An imported sidekick before it is saved. */
export interface SidekickDraft {
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeView[];
  source: SidekickSource;
}
/** A sidekick to save: an import's draft, or the editor's full definition. */
export interface SidekickDraftDef {
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeView[];
  source?: SidekickSource;
  tier?: "light" | "standard" | "deep";
  preset?: string;
  defaultOn?: boolean;
}
/** A sidekick in one scope (spec §2a.4): on or off there, its purpose text there, and the places it answers there. */
export interface SidekickInScope {
  id: string;
  name: string;
  mark: string;
  on: boolean;
  purposeText?: string;
  places?: string[];
}
/** A stored sidekick as Settings shows and edits it: its full definition and its place in the order. */
export interface SidekickView extends SidekickDraftDef {
  id: string;
  order: number;
}
/**
 * Why an import gave no draft: a file in an engine's settings folder, too many files, one too big (paste too), not
 * plain text, unreadable, nothing pasted, no engine set up (or its notice not accepted), the turn failed or gave
 * nothing usable, a newer import replaced it, or the pick's token is unknown, used or too old (choose the files again).
 */
export type SidekickImportFailure = "engine-settings" | "too-many" | "too-big" | "type" | "unreadable" | "empty" | "unavailable" | "failed" | "cancelled" | "expired";
export type SidekickImportResult =
  | { ok: true; draft: SidekickDraft; learned: { text: string; level: "you" | "harness" }[]; skipped: string[] }
  | { ok: false; reason: SidekickImportFailure; file?: string };
/** An imported sidekick's files: as read, changed since, gone (or now refused); `none` when it wasn't imported from files. */
export type SidekickOriginal = "unchanged" | "changed" | "gone" | "none";
export type SidekickOutcome = "used" | "edited" | "sent-anyway" | "dismissed";
