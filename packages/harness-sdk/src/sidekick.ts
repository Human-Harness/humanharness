import { z } from "zod";

/** The process key of Sidekick's turns in Settings › Models (`models.tasks`) and its reserved action id (spec §5). */
export const SIDEKICK_PROCESS = "sidekick";
/** The reserved app-wide collection that holds Sidekick's settings (and, in part 2, its learned items and records). */
export const SIDEKICK_COLLECTION = "sidekick";
/** Over this many tokens, `humanharness check` warns about the manifest's tips (spec §3). */
export const SIDEKICK_TIPS_TOKENS_WARN = 300;
/** Below this many words a prompt with a vague word is flagged (spec §4.1); `checks.minWords` overrides it. */
export const SIDEKICK_MIN_WORDS = 6;

/** The core's purposes (spec §2a.2). Part 1 uses only `prompt-coach`. */
export const SIDEKICK_PURPOSES = ["prompt-coach", "focus", "process-guard", "mentor", "daily-summary", "custom"] as const;
export type SidekickPurpose = (typeof SIDEKICK_PURPOSES)[number];

/** How an action's prompts are reviewed before they go out (spec §3). */
export const SIDEKICK_ACTION_MODES = ["auto", "always", "off"] as const;
export type SidekickActionMode = (typeof SIDEKICK_ACTION_MODES)[number];

const tipText = z.string().min(1).max(4000);

/** The manifest's `sidekick` block (spec §3). Absent: Sidekick is available, default off, no tips. */
export const sidekickSchema = z.strictObject({
  /** The state for a new profile. */
  default: z.enum(["on", "off"]).default("off"),
  /** Domain hints appended to the brief, in English; one text, or one per purpose. */
  tips: z.union([tipText, z.partialRecord(z.enum(SIDEKICK_PURPOSES), tipText)]).optional(),
  /** The pre-send mode per action id; free questions and unlisted actions are `auto`. */
  actions: z.record(z.string(), z.enum(SIDEKICK_ACTION_MODES)).optional(),
  /** Local-check thresholds (spec §4.1); unknown keys are refused. */
  checks: z.strictObject({ minWords: z.number().int().min(1).max(50).optional() }).optional(),
});
export type SidekickManifest = z.output<typeof sidekickSchema>;

/** The tips for `purpose`: the single text for every purpose, or that purpose's own. */
export function sidekickTips(m: SidekickManifest | undefined, purpose: SidekickPurpose = "prompt-coach"): string | undefined {
  const tips = m?.tips;
  if (tips === undefined) return undefined;
  return typeof tips === "string" ? tips : tips[purpose];
}

/** The pre-send mode of `action` (free questions: undefined → `auto`). */
export function sidekickMode(m: SidekickManifest | undefined, action: string | undefined): SidekickActionMode {
  if (action === undefined || !m?.actions || !Object.hasOwn(m.actions, action)) return "auto";
  return m.actions[action];
}

/** The local check's word threshold: the manifest's `checks.minWords`, or the core's. */
export const sidekickMinWords = (m: SidekickManifest | undefined): number => m?.checks?.minWords ?? SIDEKICK_MIN_WORDS;
