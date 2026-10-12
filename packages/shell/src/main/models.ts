import { TIERS, type Tier } from "@humanharness/harness-sdk";
import {
  type Effort,
  type EngineDef,
  type ModelChoice,
  type ModelProfile,
  type ModelSpec,
  type ModelsConfig,
  type TaskModelChoice,
  defaultTier,
  isCap,
  isEffort,
  isModelId,
} from "@humanharness/engines";

/** The key free questions' setting lives under. */
export const QUESTIONS = "questions";
/** Action ids and engine ids, as the manifest and the registry spell them. */
const KEY = /^[a-z][a-z0-9_-]{0,63}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/** The key a task's setting lives under: its action, or "questions". */
export const taskKey = (action: string | undefined): string => action ?? QUESTIONS;

/** A model, effort and cap, each checked; null when any is wrong. */
export function cleanSpec(raw: unknown): ModelSpec | null {
  if (!isObject(raw) || !isEffort(raw.effort) || !isCap(raw.cap)) return null;
  if (raw.model !== undefined && !isModelId(raw.model)) return null;
  return { ...(raw.model !== undefined ? { model: raw.model } : {}), effort: raw.effort, cap: raw.cap };
}

function cleanChoice(raw: unknown): TaskModelChoice | null {
  if (isTier(raw)) return raw;
  if (!isObject(raw) || !isObject(raw.custom)) return null;
  const spec = cleanSpec(raw.custom);
  const engine = raw.custom.engine;
  return spec && typeof engine === "string" && KEY.test(engine) ? { custom: { engine, ...spec } } : null;
}

/**
 * `config.json` → `models`, cleaned field by field (spec §7): a bad entry is dropped, so the default
 * applies. Nothing from the file reaches the engine unchecked.
 */
export function cleanModels(raw: unknown): ModelsConfig {
  if (!isObject(raw)) return {};
  const tasks: Record<string, TaskModelChoice> = {};
  if (isObject(raw.tasks)) {
    for (const [key, value] of Object.entries(raw.tasks)) {
      const choice = KEY.test(key) ? cleanChoice(value) : null;
      if (choice) tasks[key] = choice;
    }
  }
  const tiers: NonNullable<ModelsConfig["tiers"]> = {};
  if (isObject(raw.tiers)) {
    for (const [engine, table] of Object.entries(raw.tiers)) {
      if (!KEY.test(engine) || !isObject(table)) continue;
      const clean: Partial<Record<Tier, ModelSpec>> = {};
      for (const tier of TIERS) {
        const spec = cleanSpec(table[tier]);
        if (spec) clean[tier] = spec;
      }
      if (Object.keys(clean).length > 0) tiers[engine] = clean;
    }
  }
  return { ...(Object.keys(tasks).length > 0 ? { tasks } : {}), ...(Object.keys(tiers).length > 0 ? { tiers } : {}) };
}

/** A profile stored in tasks.json, checked again before it can reach the engine. */
export function cleanProfile(raw: unknown): ModelProfile | null {
  if (!isObject(raw)) return null;
  const spec = cleanSpec(raw);
  const { engine, tier } = raw;
  if (!spec || typeof engine !== "string" || !KEY.test(engine) || !(isTier(tier) || tier === "custom")) return null;
  return { engine, tier, ...spec, ...(isModelId(raw.fallbackFrom) ? { fallbackFrom: raw.fallbackFrom } : {}) };
}

/** What `tier` runs on for `engine`: the user's table, else the core's. */
export function tierSpec(engine: string, tier: Tier, models: ModelsConfig): ModelSpec {
  return { ...(models.tiers?.[engine]?.[tier] ?? defaultTier(engine, tier)) };
}

/**
 * The task's profile (spec §5): the user's custom setting for this engine, else the user's tier for the
 * task, else the manifest's, else "standard", through the user's table, else the core's.
 */
export function resolveProfile(o: { engine: string; action?: string; manifestTier?: Tier; models: ModelsConfig }): ModelProfile {
  const choice = o.models.tasks?.[taskKey(o.action)];
  if (typeof choice === "object" && choice.custom.engine === o.engine) {
    const { engine: _engine, ...spec } = choice.custom;
    return { engine: o.engine, tier: "custom", ...spec };
  }
  const tier: Tier = typeof choice === "string" ? choice : (o.manifestTier ?? "standard");
  return { engine: o.engine, tier, ...tierSpec(o.engine, tier, o.models) };
}

/**
 * The profile to retry with when the plan doesn't include `p.model` (spec §5.3): the next tier down whose
 * model hasn't failed (deep → standard → light), then the engine's default model with the same effort and
 * cap. A custom profile goes straight to the engine default. Null when `p` already runs on the default.
 */
export function nextFallback(p: ModelProfile, models: ModelsConfig, tried: readonly string[] = []): ModelProfile | null {
  if (p.model === undefined) return null;
  const from = p.fallbackFrom ?? p.model;
  const failed = new Set([...tried, p.model]);
  const below = p.tier === "custom" ? [] : TIERS.slice(0, TIERS.indexOf(p.tier)).reverse();
  for (const tier of below) {
    const spec = tierSpec(p.engine, tier, models);
    if (spec.model === undefined || !failed.has(spec.model)) return { engine: p.engine, tier, ...spec, fallbackFrom: from };
  }
  const { model: _model, fallbackFrom: _from, ...rest } = p;
  return { ...rest, fallbackFrom: from };
}

/** Whether the engine's saved list (Codex) includes the profile's model; an unknown list includes everything. */
export function offered(p: ModelProfile, list: readonly ModelChoice[] | undefined): boolean {
  return p.model === undefined || !list?.length || list.some((m) => m.id === p.model);
}

/** `p`, or the first fallback the engine's saved list includes (checked before the turn, spec §5.3). */
export function firstOffered(p: ModelProfile, models: ModelsConfig, list: readonly ModelChoice[] | undefined): ModelProfile {
  let current: ModelProfile | null = p;
  const tried: string[] = [];
  while (current && !offered(current, list)) {
    if (current.model) tried.push(current.model);
    current = nextFallback(current, models, tried);
  }
  return current ?? p;
}

/** What Settings offers for an engine: its fixed list, or the one saved from the engine (engines.json). */
export function engineOffer(engine: EngineDef, saved: { models?: ModelChoice[]; efforts?: Effort[] }): { models: ModelChoice[]; efforts: Effort[] } {
  const fixed = engine.models?.list;
  return {
    models: fixed ? fixed.map((id) => ({ id })) : [...(saved.models ?? [])],
    efforts: saved.efforts?.length && !fixed ? [...saved.efforts] : [...(engine.models?.efforts ?? ["low", "medium", "high"])],
  };
}
