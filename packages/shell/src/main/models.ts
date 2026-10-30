import { TIERS, type Tier } from "@humanharness/harness-sdk";
import {
  type Effort,
  type EngineDef,
  type ModelChoice,
  type ModelProfile,
  type ModelSpec,
  type ModelsConfig,
  type TaskModelChoice,
  isCap,
  isEffort,
  isModelId,
  PINNED_MAX,
} from "@humanharness/engines";
import { fitEffort, tierSpec } from "@humanharness/policies";
import { DEFAULT_PINNED_TOKENS } from "@humanharness/workspace";

export { QUESTIONS, firstOffered, fitEffort, nextFallback, offered, resolveProfile, taskKey, tierSpec } from "@humanharness/policies";

/** Action ids and engine ids, as the manifest and the registry spell them. */
const KEY = /^[a-z][a-z0-9_-]{0,63}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

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
  const pinned = raw.pinnedTokens;
  const pinnedTokens = typeof pinned === "number" && Number.isInteger(pinned) && pinned >= 0 && pinned <= PINNED_MAX ? pinned : undefined;
  return {
    ...(Object.keys(tasks).length > 0 ? { tasks } : {}),
    ...(Object.keys(tiers).length > 0 ? { tiers } : {}),
    ...(pinnedTokens !== undefined ? { pinnedTokens } : {}),
  };
}

/** Tokens of pinned text a new task gets whole: the person's, else the manifest's, else the core's (context-panel spec §4.2). */
export function pinnedBudget(models: ModelsConfig, manifest: { pinnedTokens: number } | undefined): number {
  return models.pinnedTokens ?? manifest?.pinnedTokens ?? DEFAULT_PINNED_TOKENS;
}

/** A profile stored in tasks.json, checked again before it can reach the engine. */
export function cleanProfile(raw: unknown): ModelProfile | null {
  if (!isObject(raw)) return null;
  const spec = cleanSpec(raw);
  const { engine, tier } = raw;
  if (!spec || typeof engine !== "string" || !KEY.test(engine) || !(isTier(tier) || tier === "custom")) return null;
  return { engine, tier, ...spec, ...(isModelId(raw.fallbackFrom) ? { fallbackFrom: raw.fallbackFrom } : {}) };
}

/**
 * The manifest's tier for a task: a plugin's prepared task's own `tier` (plugins spec §5.3), else the action's, else
 * the free questions'. The person's choice in Settings › Models still wins (resolveProfile).
 */
export function manifestTier(harness: { actions: Record<string, { tier?: Tier }>; questions?: { tier?: Tier } }, action: string | undefined, tier?: Tier): Tier | undefined {
  if (tier !== undefined) return tier;
  if (action === undefined) return harness.questions?.tier;
  return Object.hasOwn(harness.actions, action) ? harness.actions[action].tier : undefined;
}

/**
 * The tier a profile counts as (task-modes spec §5.3): its own; a custom one, the highest tier whose model it runs on
 * this engine (the user's table, else the core's), else by its effort (low → light, medium → standard, more → deep).
 */
export function nearestTier(p: ModelProfile, models: ModelsConfig): Tier {
  if (p.tier !== "custom") return p.tier;
  if (p.model !== undefined) {
    for (const tier of [...TIERS].reverse()) if (tierSpec(p.engine, tier, models).model === p.model) return tier;
  }
  return p.effort === "low" ? "light" : p.effort === "medium" ? "standard" : "deep";
}

/** What Settings offers for an engine: its fixed list, or the one saved from the engine (engines.json). */
export function engineOffer(engine: EngineDef, saved: { models?: ModelChoice[]; efforts?: Effort[] }): { models: ModelChoice[]; efforts: Effort[] } {
  const fixed = engine.models?.list;
  // engines.json is cleaned when read; checked again here, as these can reach the engine.
  const savedModels = (saved.models ?? []).filter((m) => isModelId(m?.id));
  const savedEfforts = (saved.efforts ?? []).filter(isEffort);
  return {
    models: fixed ? fixed.map((id) => ({ id })) : savedModels,
    efforts: savedEfforts.length && !fixed ? savedEfforts : [...(engine.models?.efforts ?? ["low", "medium", "high"])],
  };
}

/** `p` with an effort `engine` offers (`engineOffer`), for a profile that didn't come from a pick (a fallback, a restored task). */
export function offeredEffort(p: ModelProfile, engine: EngineDef, saved: { models?: ModelChoice[]; efforts?: Effort[] }): ModelProfile {
  return fitEffort(p, engineOffer(engine, saved).efforts);
}
