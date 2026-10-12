import { promises as fs } from "node:fs";
import path from "node:path";
import type { LimitWindow } from "@humanharness/runtime";
import type { ChatEntry, TurnUsage, UsageSummary } from "@humanharness/ui/client";

/** Which task (and which of its phases) a turn belongs to. */
export interface UsageMeta {
  action?: string;
  task?: string;
  /** `run`: the task's own turns; `close`: the turn that asks for its note. */
  phase?: "run" | "close";
}

/** One turn in `<folder>/.harness/usage.jsonl`. Only what the engine reported; never leaves the machine. */
export interface UsageRecord {
  at: string;
  engine: string;
  action?: string;
  task?: string;
  phase?: "run" | "close";
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

/** The usage record for a finished turn, or null when the engine reported nothing. */
export function usageRecord(entry: ChatEntry, engine: string, meta: UsageMeta = {}, firstLimits?: LimitWindow[]): UsageRecord | null {
  if (!entry.usage && !entry.limits) return null;
  return {
    at: entry.at,
    engine,
    ...(meta.action ? { action: meta.action } : {}),
    ...(meta.task ? { task: meta.task } : {}),
    ...(meta.phase ? { phase: meta.phase } : {}),
    ok: !entry.error,
    ...(entry.usage ? { usage: entry.usage } : {}),
    ...(entry.limits ? { limits: entry.limits } : {}),
    ...(firstLimits ? { firstLimits } : {}),
  };
}

const FIVE_HOUR = "five_hour";

/**
 * Current limits and per-action estimates. Claude reports the windows mid-turn (after the first
 * API response), so a turn's snapshot shows usage from before most of that turn: a turn's cost is
 * the rise of the five-hour window from its first snapshot to the next turn's first, when the next
 * turn has one and the window hasn't reset in between. Other use of the same account counts too, so it is a
 * rough guide.
 */
export function summarizeUsage(records: UsageRecord[], now: Date = new Date()): UsageSummary {
  const fiveHour = (r: UsageRecord | undefined) => (r?.firstLimits ?? r?.limits)?.find((w) => w.kind === FIVE_HOUR);
  const last = records.filter((r) => r.limits && r.limits.length > 0).at(-1);
  const sums: Record<string, { total: number; n: number }> = {};
  for (let i = 0; i < records.length - 1; i++) {
    const r = records[i];
    if (!r.action) continue;
    const before = fiveHour(r);
    const after = fiveHour(records[i + 1]);
    if (!before || !after || before.resetsAt !== after.resetsAt) continue;
    const sum = (sums[r.action] ??= { total: 0, n: 0 });
    sum.total += Math.max(0, after.utilization - before.utilization);
    sum.n++;
  }
  return {
    limits: last ? last.limits!.filter((w) => Date.parse(w.resetsAt) > now.getTime()) : null,
    estimates: Object.fromEntries(Object.entries(sums).map(([action, s]) => [action, s.total / s.n])),
  };
}
