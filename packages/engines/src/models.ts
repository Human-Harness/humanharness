import type { Tier } from "@humanharness/harness-sdk";

/** Reasoning effort as both engines name it (Claude `--effort`, Codex `model_reasoning_effort`). */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** What a tier (or a custom task) runs on. `model` absent: the engine's own default model. */
export interface ModelSpec {
  model?: string;
  effort: Effort;
  /** Context cap in tokens: the engine compacts when it reaches it. */
  cap: number;
}

/** The model a task runs on: resolved once when the task starts and kept with it (spec §5). */
export interface ModelProfile extends ModelSpec {
  engine: string;
  tier: Tier | "custom";
  /** After a fallback: the model the plan didn't include. */
  fallbackFrom?: string;
}

/** A task the user set to custom in Settings › Modelos. */
export interface CustomModel extends ModelSpec {
  engine: string;
}

/** A task's setting: a tier, or its own model. */
export type TaskModelChoice = Tier | { custom: CustomModel };

/** `config.json` → `models` (per app, so per harness). Always read through the shell's `cleanModels`. */
export interface ModelsConfig {
  /** By action id, or "questions" for free questions. */
  tasks?: Record<string, TaskModelChoice>;
  /** By engine id, then tier: overrides of DEFAULT_TIERS. */
  tiers?: Record<string, Partial<Record<Tier, ModelSpec>>>;
}

/** A model an engine offers (Codex: from `session/new` `configOptions`). */
export interface ModelChoice {
  id: string;
  name?: string;
  description?: string;
}

/** What an engine offers in Settings: a fixed model list (Claude's aliases) and its efforts. */
export interface EngineModels {
  /** Fixed model ids; absent when the list comes from the engine itself (Codex, saved in engines.json). */
  list?: readonly string[];
  efforts: readonly Effort[];
}

export const MIN_CAP = 100_000;
export const MAX_CAP = 1_000_000;
/** The context caps Settings offers (spec §5.1). */
export const CAP_OPTIONS = [100_000, 200_000, 400_000, 1_000_000] as const;
/** Claude's aliases always point at the latest model of each family. */
export const CLAUDE_MODELS = ["haiku", "sonnet", "opus"] as const;

/** One part of a model id: letters, digits and `._:[]-`. */
const MODEL_PART = /^[A-Za-z0-9._:\[\]-]+$/;

/**
 * A model id safe to put on a command line, in CODEX_CONFIG or in an ACP request: never a flag. OpenCode names
 * models `provider/model` (OpenRouter adds one more part), so up to three `/`-separated parts.
 */
export function isModelId(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 128 || v.startsWith("-")) return false;
  const parts = v.split("/");
  return parts.length <= 3 && parts.every((p) => p !== "" && p !== "." && p !== ".." && MODEL_PART.test(p));
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === "string" && (EFFORTS as readonly string[]).includes(v);
}

export function isCap(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_CAP && v <= MAX_CAP;
}

/** The engine's default model at each tier: only the effort and the cap change. */
const ENGINE_DEFAULT: Readonly<Record<Tier, ModelSpec>> = {
  light: { effort: "low", cap: 100_000 },
  standard: { effort: "medium", cap: 200_000 },
  deep: { effort: "high", cap: 400_000 },
};

/** The core's tables (spec §5.1). Codex leaves `model` out so the defaults follow the engine's own. */
export const DEFAULT_TIERS: Readonly<Record<string, Readonly<Record<Tier, ModelSpec>>>> = {
  claude: {
    light: { model: "haiku", effort: "low", cap: 100_000 },
    standard: { model: "sonnet", effort: "medium", cap: 200_000 },
    deep: { model: "opus", effort: "high", cap: 400_000 },
  },
  codex: ENGINE_DEFAULT,
};

/** The core's spec for `tier` on `engine`; an engine without a table runs on its default model. */
export function defaultTier(engine: string, tier: Tier): ModelSpec {
  return { ...(DEFAULT_TIERS[engine] ?? ENGINE_DEFAULT)[tier] };
}
