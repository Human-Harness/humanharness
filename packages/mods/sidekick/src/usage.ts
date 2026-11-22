// Sidekick's lines in `<base>/.harness/usage.jsonl` (sidekick spec §8): the slice of the shell's usage log it reads
// and writes, so the mod imports nothing of the shell.
import { promises as fs } from "node:fs";
import type { Effort, ModelProfile } from "@humanharness/engines";
import type { Tier } from "@humanharness/harness-sdk";
import type { LimitWindow } from "@humanharness/runtime";
import type { TurnUsage } from "@humanharness/protocol";
import { usageFile } from "@humanharness/workspace";

/** A Sidekick usage line's moment (sidekick spec §8); `place:<id>` is a harness place's turn (§2a.5). */
export type SidekickUsageMoment = "pre" | "after" | "learn" | "route" | "phase-change" | "daily" | "before-approve" | "import" | `place:${string}`;

/** One line of the usage log, as far as Sidekick reads it (the shell's `UsageRecord` has more fields). */
export interface UsageRecord {
  at: string;
  engine: string;
  action?: string;
  task?: string;
  scope?: string;
  /** The turn's kind; Sidekick's lines are `sidekick`. */
  phase?: string;
  process?: string;
  moment?: SidekickUsageMoment | (string & {});
  /** Which sidekick spoke. */
  sidekick?: string;
  tier?: Tier | "custom";
  model?: string;
  effort?: Effort;
  cap?: number;
  ok: boolean;
  usage?: TurnUsage;
  limits?: LimitWindow[];
}

/** What counts toward Sidekick's cap (plan Decision 3): input, output and cache writes; cache reads are left out. */
export const capTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheWriteTokens;
const turnTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/** One Sidekick turn (sidekick spec §8): a tagged line of kind `sidekick`, as the shell's `sidekickRecord` writes it. */
export function sidekickRecord(
  o: { engine: string; task?: string; scope?: string; action?: string; sidekick: string; moment: SidekickUsageMoment; profile: ModelProfile; ok: boolean; usage?: TurnUsage; limits?: LimitWindow[] },
  at: string = new Date().toISOString(),
): UsageRecord {
  const p = o.profile;
  return {
    at,
    engine: o.engine,
    ...(o.action ? { action: o.action } : {}),
    ...(o.task ? { task: o.task } : {}),
    ...(o.scope ? { scope: o.scope } : {}),
    phase: "sidekick",
    process: "sidekick",
    moment: o.moment,
    sidekick: o.sidekick,
    tier: p.tier,
    ...(p.model !== undefined ? { model: p.model } : {}),
    effort: p.effort,
    cap: p.cap,
    ok: o.ok,
    ...(o.usage ? { usage: o.usage } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  };
}

const own = (records: UsageRecord[]) => records.filter((r) => r.phase === "sidekick" && r.usage);

/** Sidekick's tokens toward the cap in `task`. */
export function sidekickSpent(records: UsageRecord[], task: string): number {
  return own(records)
    .filter((r) => r.task === task)
    .reduce((n, r) => n + capTokens(r.usage!), 0);
}

/** Sidekick's tokens (all four counts) in the last 7 days, for Settings › Sidekick. */
export function sidekickWeek(records: UsageRecord[], now: Date = new Date()): number {
  const since = now.getTime() - 7 * 86_400_000;
  return own(records)
    .filter((r) => Date.parse(r.at) >= since)
    .reduce((n, r) => n + turnTokens(r.usage!), 0);
}

/** Sidekick's own lines in `base`'s usage log ([] when there is none); a broken line is skipped. */
export async function readSidekickUsage(base: string): Promise<UsageRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(usageFile(base), "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const r = JSON.parse(line) as UsageRecord;
        return r.phase === "sidekick" ? [r] : [];
      } catch {
        return []; // a broken line
      }
    });
}
