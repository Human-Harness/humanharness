import { promises as fs } from "node:fs";
import path from "node:path";
import type { LimitWindow } from "@humanharness/runtime";
import type { ChatEntry, TurnUsage, UsageSummary } from "@humanharness/ui/client";

/** One turn in `<folder>/.harness/usage.jsonl`. Only what the engine reported; never leaves the machine. */
export interface UsageRecord {
  at: string;
  engine: string;
  action?: string;
  ok: boolean;
  usage?: TurnUsage;
  limits?: LimitWindow[];
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
export function usageRecord(entry: ChatEntry, engine: string, action?: string): UsageRecord | null {
  if (!entry.usage && !entry.limits) return null;
  return {
    at: entry.at,
    engine,
    ...(action ? { action } : {}),
    ok: !entry.error,
    ...(entry.usage ? { usage: entry.usage } : {}),
    ...(entry.limits ? { limits: entry.limits } : {}),
  };
}

const FIVE_HOUR = "five_hour";

/**
 * Current limits and per-action estimates. An action's estimate is the mean rise of the five-hour
 * window over its turns, each measured against the previous snapshot of the same window. Other use
 * of the same account counts too, so it is a rough guide.
 */
export function summarizeUsage(records: UsageRecord[], now: Date = new Date()): UsageSummary {
  const snapshots = records.filter((r) => r.limits && r.limits.length > 0);
  const last = snapshots.at(-1);
  const sums: Record<string, { total: number; n: number }> = {};
  for (let i = 1; i < snapshots.length; i++) {
    const r = snapshots[i];
    if (!r.action) continue;
    const before = snapshots[i - 1].limits!.find((w) => w.kind === FIVE_HOUR);
    const after = r.limits!.find((w) => w.kind === FIVE_HOUR);
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
