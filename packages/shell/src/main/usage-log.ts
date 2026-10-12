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

const FIVE_HOUR = "five_hour";

/**
 * Current limits and per-action estimates. Claude reports the windows mid-turn (after the first
 * API response), so a turn's snapshot shows usage from before most of that turn: a turn's cost is
 * the rise of the five-hour window from its first snapshot to the next turn's first, when the next
 * turn has one and the window hasn't reset in between. A task costs the sum of its turns (follow-ups
 * included, its closing turn left out); a task with a turn that can't be measured is left out, and an
 * action's estimate is the average over its tasks. Lines from before tasks were logged count as a task
 * each. Other use of the same account counts too, so it is a rough guide. Checkpoint turns and compaction
 * lines are left out.
 */
export function summarizeUsage(records: UsageRecord[], now: Date = new Date()): UsageSummary {
  records = records.filter((r) => r.kind !== "compaction");
  const fiveHour = (r: UsageRecord | undefined) => (r?.firstLimits ?? r?.limits)?.find((w) => w.kind === FIVE_HOUR);
  const last = records.filter((r) => r.limits && r.limits.length > 0).at(-1);
  const tasks = new Map<string, { action: string; total: number; measured: boolean }>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.action || r.phase === "close" || r.kind) continue;
    const key = r.task ? `task:${r.task}` : `line:${i}`;
    const task = tasks.get(key) ?? { action: r.action, total: 0, measured: true };
    tasks.set(key, task);
    const before = fiveHour(r);
    const after = fiveHour(records[i + 1]);
    if (!before || !after || before.resetsAt !== after.resetsAt) task.measured = false;
    else task.total += Math.max(0, after.utilization - before.utilization);
  }
  const sums: Record<string, { total: number; n: number }> = {};
  for (const task of tasks.values()) {
    if (!task.measured) continue;
    const sum = (sums[task.action] ??= { total: 0, n: 0 });
    sum.total += task.total;
    sum.n++;
  }
  return {
    limits: last ? last.limits!.filter((w) => Date.parse(w.resetsAt) > now.getTime()) : null,
    estimates: Object.fromEntries(Object.entries(sums).map(([action, s]) => [action, s.total / s.n])),
  };
}
