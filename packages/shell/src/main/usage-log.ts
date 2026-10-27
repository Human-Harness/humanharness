import { promises as fs } from "node:fs";
import path from "node:path";
import { usageFile } from "@humanharness/workspace";
import type { Effort, ModelProfile } from "@humanharness/engines";
import type { Tier } from "@humanharness/harness-sdk";
import { MEASURED_MIN, type MeasuredCosts } from "@humanharness/material/light";
import type { LimitWindow } from "@humanharness/runtime";
import type { ChatEntry, TurnUsage, UsageSummary } from "@humanharness/ui/client";

/** The task's profile (plan 4a's `humanharness run` calibrates tiers from these) and what the engine said it ran. */
interface ProfileFields {
  tier?: Tier | "custom";
  model?: string;
  effort?: Effort;
  cap?: number;
  reportedModel?: string;
}

/**
 * What kind of turn it was: `run` (the task's own turns), `close` (the turn that asks for its note), `checkpoint` (the
 * quiet note before the cap), `phase-change` (the brief of the phase the task enters) and `wrap-up` (the time box's
 * last turn before the close phase). Not the task's phase: that is `taskPhase`. `material`: an AI stage of material
 * processing, not a task's turn (material spec §11).
 */
export type TurnKind = "run" | "close" | "checkpoint" | "phase-change" | "wrap-up" | "material";

/** Which task (and which kind of turn) a turn belongs to. */
export interface UsageMeta extends ProfileFields {
  action?: string;
  task?: string;
  /** The task's scope (`_app` included); only for a harness with scopes. */
  scope?: string;
  /** The task's mode while the turn ran (task-modes spec §5.5). Absent without one. */
  mode?: string;
  /** The task's phase while the turn ran (task-phases spec §6). Absent without phases. */
  taskPhase?: string;
  /** The turn's kind (TurnKind). */
  phase?: TurnKind;
}

/** One turn in `<folder>/.harness/usage.jsonl`. Only what the engine reported; never leaves the machine. */
export interface UsageRecord extends ProfileFields {
  at: string;
  engine: string;
  action?: string;
  task?: string;
  /** The task's scope (`_app` included); only for a harness with scopes. */
  scope?: string;
  /** The task's mode while the turn ran (task-modes spec §5.5). Absent without one. */
  mode?: string;
  /** The task's phase while the turn ran (task-phases spec §6). Absent without phases. */
  taskPhase?: string;
  phase?: TurnKind;
  /** Material lines only: the stage, and the source it ran for (none for the scope's sheet and links). */
  stage?: string;
  source?: string;
  /** Material lines only: the fragments the stage handled (its prompt listed). */
  fragments?: number;
  /** `checkpoint`: the quiet turn that saves a note before the cap; `compaction`: the engine compacted (no usage). */
  kind?: "checkpoint" | "compaction";
  ok: boolean;
  usage?: TurnUsage;
  /** Latest windows the turn reported. */
  limits?: LimitWindow[];
  /** The turn's first snapshot, when it reported any: estimates measure from it. */
  firstLimits?: LimitWindow[];
}

export class UsageLog {
  private readonly file: string;

  constructor(folder: string) {
    this.file = usageFile(folder);
  }

  async append(record: UsageRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, JSON.stringify(record) + "\n");
  }

  async load(limit = 500): Promise<UsageRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const records: UsageRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as UsageRecord);
      } catch {
        // skip a broken line
      }
    }
    return records.slice(-limit);
  }
}

/** A profile as usage.jsonl records it. */
export function profileMeta(p: ModelProfile): Pick<UsageMeta, "tier" | "model" | "effort" | "cap"> {
  return { tier: p.tier, ...(p.model !== undefined ? { model: p.model } : {}), effort: p.effort, cap: p.cap };
}

function metaFields(meta: UsageMeta): Partial<UsageRecord> {
  return {
    ...(meta.action ? { action: meta.action } : {}),
    ...(meta.task ? { task: meta.task } : {}),
    ...(meta.scope ? { scope: meta.scope } : {}),
    ...(meta.mode ? { mode: meta.mode } : {}),
    ...(meta.taskPhase ? { taskPhase: meta.taskPhase } : {}),
    ...(meta.phase ? { phase: meta.phase } : {}),
    ...(meta.phase === "checkpoint" ? { kind: "checkpoint" as const } : {}),
    ...(meta.tier ? { tier: meta.tier } : {}),
    ...(meta.model ? { model: meta.model } : {}),
    ...(meta.effort ? { effort: meta.effort } : {}),
    ...(meta.cap ? { cap: meta.cap } : {}),
    ...(meta.reportedModel ? { reportedModel: meta.reportedModel } : {}),
  };
}

/** The usage record for a finished turn, or null when the engine reported nothing. */
export function usageRecord(entry: ChatEntry, engine: string, meta: UsageMeta = {}, firstLimits?: LimitWindow[]): UsageRecord | null {
  if (!entry.usage && !entry.limits) return null;
  return {
    at: entry.at,
    engine,
    ...metaFields(meta),
    ok: !entry.error,
    ...(entry.usage ? { usage: entry.usage } : {}),
    ...(entry.limits ? { limits: entry.limits } : {}),
    ...(firstLimits ? { firstLimits } : {}),
  };
}

/** A line for a compaction the task manager detected (spec §8). */
export function compactionRecord(engine: string, meta: UsageMeta, at: string = new Date().toISOString()): UsageRecord {
  return { at, engine, ...metaFields(meta), kind: "compaction", ok: true };
}

/** One AI stage of material processing (material spec §11). */
export function materialRecord(
  o: { engine: string; stage: string; scope: string; source?: string; profile: ModelProfile; ok: boolean; fragments?: number; usage?: TurnUsage; limits?: LimitWindow[] },
  at: string = new Date().toISOString(),
): UsageRecord {
  return {
    at,
    engine: o.engine,
    phase: "material",
    stage: o.stage,
    scope: o.scope,
    ...(o.source ? { source: o.source } : {}),
    ...profileMeta(o.profile),
    ok: o.ok,
    ...(o.fragments !== undefined ? { fragments: o.fragments } : {}),
    ...(o.usage ? { usage: o.usage } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  };
}

/** Free questions (no action) are measured under this key, like Settings › Modelos. */
const QUESTIONS = "questions";
/** Estimates and tokens average each action's latest tasks, so a change of model or plan settles in after a few uses. */
export const RECENT_TASKS = 10;

const turnTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/** The spending window of Settings › Usage (spec §4). */
export const SPENT_DAYS = 30;

/** USD spent in the last SPENT_DAYS days, material stages included; undefined when no line has a cost (D0: Claude and Codex never do). */
function spentUsd(records: UsageRecord[], now: Date): number | undefined {
  const withCost = records.filter((r) => typeof r.usage?.costUsd === "number");
  if (withCost.length === 0) return undefined;
  const since = now.getTime() - SPENT_DAYS * 86_400_000;
  return withCost.filter((r) => Date.parse(r.at) >= since).reduce((sum, r) => sum + r.usage!.costUsd!, 0);
}

/** The average of the last RECENT_TASKS values of each key. */
function recentAverages(values: Map<string, number[]>): Record<string, number> {
  return Object.fromEntries(
    [...values].map(([key, all]) => {
      const recent = all.slice(-RECENT_TASKS);
      return [key, recent.reduce((a, b) => a + b, 0) / recent.length];
    }),
  );
}

/**
 * Current limits, per-action estimates and per-action tokens. Claude reports the windows mid-turn
 * (after the first API response), so a turn's snapshot shows usage from before most of that turn: a
 * turn's cost is the rise of the `primary` window (the engine's `limits.primary`) from its first
 * snapshot to the next turn's first, when the next turn has one and the window hasn't reset in
 * between. A task costs the sum of its turns (follow-ups included, its closing turn left out); a task
 * with a turn that can't be measured is left out, and an action's estimate is the average over its
 * last RECENT_TASKS measured tasks. Tokens work the same way for every engine: a task counts when all
 * of its turns reported usage. Free questions count under "questions". Lines from before tasks were
 * logged count as a task each. Other use of the same account counts too, so it is a rough guide.
 * Checkpoint turns and compaction lines are left out, and so are material stages (not tasks; their windows still
 * count as the latest limits).
 */
export function summarizeUsage(records: UsageRecord[], primary: string | undefined, now: Date = new Date()): UsageSummary {
  const all = records.filter((r) => r.kind !== "compaction");
  const last = all.filter((r) => r.limits && r.limits.length > 0).at(-1);
  const window = (r: UsageRecord | undefined) => (primary ? (r?.firstLimits ?? r?.limits)?.find((w) => w.kind === primary) : undefined);
  const tasks = new Map<string, { action: string; total: number; measured: boolean; tokens: number; counted: boolean }>();
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (r.phase === "close" || r.phase === "material" || r.kind) continue;
    const action = r.action ?? QUESTIONS;
    const key = r.task ? `task:${r.task}` : `line:${i}`;
    const task = tasks.get(key) ?? { action, total: 0, measured: true, tokens: 0, counted: true };
    tasks.set(key, task);
    const before = window(r);
    const next = all[i + 1];
    const after = window(next);
    // A material stage right after the turn would be charged to it: the turn can't be measured.
    if (!before || !after || before.resetsAt !== after.resetsAt || next?.phase === "material") task.measured = false;
    else task.total += Math.max(0, after.utilization - before.utilization);
    if (r.usage) task.tokens += turnTokens(r.usage);
    else task.counted = false;
  }
  const shares = new Map<string, number[]>();
  const tokens = new Map<string, number[]>();
  for (const task of tasks.values()) {
    if (task.measured) shares.set(task.action, [...(shares.get(task.action) ?? []), task.total]);
    if (task.counted) tokens.set(task.action, [...(tokens.get(task.action) ?? []), task.tokens]);
  }
  // Settings › Uso per scope (spec §3.3): every turn's tokens, close and checkpoint turns included.
  const perScope = new Map<string, number>();
  for (const r of all) if (r.scope && r.phase !== "material") perScope.set(r.scope, (perScope.get(r.scope) ?? 0) + (r.usage ? turnTokens(r.usage) : 0));
  // Material processing's own total (material spec §11); absent when no stage ever ran, so D0 keeps its summary.
  const material = all.filter((r) => r.phase === "material" && r.usage).reduce((n, r) => n + turnTokens(r.usage!), 0);
  const spent = spentUsd(all, now);
  return {
    limits: last ? last.limits!.filter((w) => Date.parse(w.resetsAt) > now.getTime()) : null,
    estimates: recentAverages(shares),
    tokens: recentAverages(tokens),
    ...(perScope.size ? { scopes: Object.fromEntries(perScope) } : {}),
    ...(material > 0 ? { material } : {}),
    ...(spent !== undefined ? { spentUsd: spent } : {}),
    ...(primary ? { primary } : {}),
  };
}

/**
 * Per-fragment token costs of each material stage, measured from its lines (material spec §7): a stage with at least
 * MEASURED_MIN lines that ran and report usage (and, but for the sheet, the fragments they handled) gets its average;
 * the sheet's is per run. Undefined when no stage has enough, so the estimates keep the constants.
 */
export function measuredMaterialCosts(records: UsageRecord[]): MeasuredCosts | undefined {
  const out: MeasuredCosts = {};
  for (const stage of ["label", "review", "link", "sheet"] as const) {
    const per = records.flatMap((r) => {
      if (r.phase !== "material" || r.stage !== stage || !r.ok || !r.usage) return [];
      const n = stage === "sheet" ? 1 : (r.fragments ?? 0);
      return n > 0 ? [turnTokens(r.usage) / n] : [];
    });
    if (per.length >= MEASURED_MIN) out[stage] = Math.round(per.reduce((a, b) => a + b, 0) / per.length);
  }
  return Object.keys(out).length ? out : undefined;
}

/** A turn from one profile's log, with the profile it came from. ("person", not "profile": a model profile is another thing here.) */
export type PersonUsageRecord = UsageRecord & { person: string };

/** Every profile's records in one list, oldest first (a stable sort keeps each log's own order for equal times). */
export function mergeUsage(byProfile: Record<string, UsageRecord[]>): PersonUsageRecord[] {
  return Object.entries(byProfile)
    .flatMap(([person, records]) => records.map((r) => ({ ...r, person })))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Settings › Usage in a harness with profiles (spec §4 "Usage"): one AI plan for the whole app, so every profile's
 * turns, in time order, measure its window and estimates. `scopes` are the active profile's only (scope ids repeat
 * across people), and so is `material` (each profile processes its own); `profiles` counts every turn's tokens per
 * profile, material stages included. `spentUsd` is everyone's: one provider account pays.
 */
export function profilesUsage(
  byProfile: Record<string, UsageRecord[]>,
  activeProfile: string,
  primary: string | undefined,
  now: Date = new Date(),
): UsageSummary {
  const merged = mergeUsage(byProfile);
  const { scopes: _everyone, material: _all, ...summary } = summarizeUsage(merged, primary, now);
  const own = summarizeUsage(Object.hasOwn(byProfile, activeProfile) ? byProfile[activeProfile] : [], primary, now);
  // Material stages count as their person's use: each profile processes its own material (material spec §4).
  const perPerson: Record<string, number> = {};
  for (const r of merged) if (r.usage) perPerson[r.person] = (perPerson[r.person] ?? 0) + turnTokens(r.usage);
  return { ...summary, ...(own.scopes ? { scopes: own.scopes } : {}), ...(own.material !== undefined ? { material: own.material } : {}), profiles: perPerson };
}
