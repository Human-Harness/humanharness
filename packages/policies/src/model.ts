import { TIERS, type Tier, tierBelow } from "@humanharness/harness-sdk";
import { EFFORTS, type Effort, type ModelChoice, type ModelProfile, type ModelSpec, type ModelsConfig, defaultTier } from "@humanharness/engines";

/** The key free questions' setting lives under. */
export const QUESTIONS = "questions";

/** The key a task's setting lives under: its action, or "questions". */
export const taskKey = (action: string | undefined): string => action ?? QUESTIONS;

/** What `tier` runs on for `engine`: the user's table, else the core's. */
export function tierSpec(engine: string, tier: Tier, models: ModelsConfig): ModelSpec {
  return { ...(models.tiers?.[engine]?.[tier] ?? defaultTier(engine, tier)) };
}

/**
 * The task's profile (spec §5): the user's custom setting for this engine, else the user's tier for the
 * task, else the manifest's, else "standard", through the user's table, else the core's. `floor` (a mode's
 * `minTier`, task-modes spec §5.3) raises a lower tier to it and never lowers one; a custom setting stays.
 */
export function resolveProfile(o: { engine: string; action?: string; manifestTier?: Tier; models: ModelsConfig; floor?: Tier }): ModelProfile {
  const choice = o.models.tasks?.[taskKey(o.action)];
  if (typeof choice === "object" && choice.custom.engine === o.engine) {
    const { engine: _engine, ...spec } = choice.custom;
    return { engine: o.engine, tier: "custom", ...spec };
  }
  const chosen: Tier = typeof choice === "string" ? choice : (o.manifestTier ?? "standard");
  const tier = o.floor !== undefined && tierBelow(chosen, o.floor) ? o.floor : chosen;
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

/**
 * `p` with an effort the engine offers (`efforts`, from `engineOffer`): an unsupported one is lowered to the
 * closest offered below it, else raised to the lowest offered. An empty list leaves `p` as it is.
 */
export function fitEffort(p: ModelProfile, efforts: readonly Effort[]): ModelProfile {
  if (efforts.length === 0 || efforts.includes(p.effort)) return p;
  const rank = (e: Effort) => EFFORTS.indexOf(e);
  const sorted = [...efforts].sort((a, b) => rank(a) - rank(b));
  const below = sorted.filter((e) => rank(e) < rank(p.effort)).at(-1);
  return { ...p, effort: below ?? sorted[0] };
}

/** What a pick needs (spec §6). `tier`: a fixed tier that skips the person's choice and the manifest (the Sidekick's own). */
export interface PickInput {
  engine: string;
  action?: string;
  manifestTier?: Tier;
  tier?: Tier;
  models: ModelsConfig;
  floor?: Tier;
  /** What the engine offers (`engineOffer`): a model off the list falls back before the turn, an effort is fitted. */
  offer?: { models: readonly ModelChoice[]; efforts: readonly Effort[] };
}

/** Decides which model profile a task runs on and what to retry with (spec §6). Decides only: no I/O. */
export interface ModelPolicy {
  id: string;
  pick(input: PickInput): ModelProfile;
  fallback(profile: ModelProfile, models: ModelsConfig, tried: readonly string[]): ModelProfile | null;
}

/** Today's rules: the person's choice, else the manifest's tier, the mode's floor, deep → standard → light → the engine's default. */
export const DefaultModelPolicy: ModelPolicy = {
  id: "default",
  pick(o) {
    const base =
      o.tier !== undefined
        ? { engine: o.engine, tier: o.tier, ...tierSpec(o.engine, o.tier, o.models) }
        : resolveProfile({ engine: o.engine, action: o.action, manifestTier: o.manifestTier, models: o.models, floor: o.floor });
    if (!o.offer) return base;
    return fitEffort(firstOffered(base, o.models, o.offer.models), o.offer.efforts);
  },
  fallback: (profile, models, tried) => nextFallback(profile, models, tried),
};
