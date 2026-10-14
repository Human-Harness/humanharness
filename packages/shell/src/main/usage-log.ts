import { promises as fs } from "node:fs";
import path from "node:path";
import type { Effort, ModelProfile } from "@humanharness/engines";
import type { Tier } from "@humanharness/harness-sdk";
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

/** Which task (and which of its phases) a turn belongs to. */
export interface UsageMeta extends ProfileFields {
  action?: string;
  task?: string;
  /**
   * `run`: the task's own turns; `close`: the turn that asks for its note; `checkpoint`: the quiet turn that
   * saves a note before the context reaches its cap.
   */
  phase?: "run" | "close" | "checkpoint";
}

/** One turn in `<folder>/.harness/usage.jsonl`. Only what the engine reported; never leaves the machine. */
export interface UsageRecord extends ProfileFields {
  at: string;
  engine: string;
  action?: string;
  task?: string;
  phase?: "run" | "close" | "checkpoint";
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
    this.file = path.join(folder, ".harness", "usage.jsonl");
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

/** Free questions (no action) are measured under this key, like Settings › Modelos. */
const QUESTIONS = "questions";
/** Estimates and tokens average each action's latest tasks, so a change of model or plan settles in after a few uses. */
export const RECENT_TASKS = 10;

const turnTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

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
 * Checkpoint turns and compaction lines are left out.
 */
export function summarizeUsage(records: UsageRecord[], primary: string | undefined, now: Date = new Date()): UsageSummary {
  records = records.filter((r) => r.kind !== "compaction");
  const window = (r: UsageRecord | undefined) => (primary ? (r?.firstLimits ?? r?.limits)?.find((w) => w.kind === primary) : undefined);
  const last = records.filter((r) => r.limits && r.limits.length > 0).at(-1);
  const tasks = new Map<string, { action: string; total: number; measured: boolean; tokens: number; counted: boolean }>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.phase === "close" || r.kind) continue;
    const action = r.action ?? QUESTIONS;
    const key = r.task ? `task:${r.task}` : `line:${i}`;
    const task = tasks.get(key) ?? { action, total: 0, measured: true, tokens: 0, counted: true };
    tasks.set(key, task);
    const before = window(r);
    const after = window(records[i + 1]);
    if (!before || !after || before.resetsAt !== after.resetsAt) task.measured = false;
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
  return {
    limits: last ? last.limits!.filter((w) => Date.parse(w.resetsAt) > now.getTime()) : null,
    estimates: recentAverages(shares),
    tokens: recentAverages(tokens),
    ...(primary ? { primary } : {}),
  };
}
