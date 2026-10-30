import path from "node:path";
import type { ActionCost } from "@humanharness/harness-sdk";
import type { UsageMeta } from "@humanharness/shell/tasks";
import type { TurnUsage } from "@humanharness/protocol";

export const REPORT_PHASES = ["run", "follow-up", "checkpoint", "close"] as const;
export type ReportPhase = (typeof REPORT_PHASES)[number];

export interface PhaseUsage {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What `run` prints at the end (spec §8). */
export interface RunReport {
  folder: string;
  action: string;
  /** The action's declared cost hint. */
  cost: ActionCost;
  tier?: string;
  /** Absent: the engine's default model. */
  model?: string;
  /** The model the engine said it ran. */
  reportedModel?: string;
  effort?: string;
  cap?: number;
  phases: Partial<Record<ReportPhase, PhaseUsage>>;
  /** The most context the task's session held after a turn. */
  peakContext?: number;
  notePath?: string;
}

/** Adds up the turns `run` records: the same TurnController calls the app's usage log gets. */
export class UsageTally {
  private readonly phases: Partial<Record<ReportPhase, PhaseUsage>> = {};
  private profile: Pick<RunReport, "tier" | "model" | "reportedModel" | "effort" | "cap"> = {};
  private peak: number | undefined;
  private task: string | undefined;
  private ranFirst = false;

  add(meta: UsageMeta, usage: TurnUsage | undefined, ok: boolean): void {
    if (meta.task !== this.task) {
      this.task = meta.task;
      this.ranFirst = false;
    }
    const phase: ReportPhase = meta.phase === "close" || meta.phase === "checkpoint" ? meta.phase : this.ranFirst ? "follow-up" : "run";
    if (phase === "run" && ok) this.ranFirst = true;
    if (meta.tier) {
      // The latest profile wins: after a fallback, it is the one that ran.
      this.profile = {
        tier: meta.tier,
        ...(meta.model ? { model: meta.model } : {}),
        ...(meta.effort ? { effort: meta.effort } : {}),
        ...(meta.cap ? { cap: meta.cap } : {}),
        ...(this.profile.reportedModel ? { reportedModel: this.profile.reportedModel } : {}),
      };
    }
    if (meta.reportedModel) this.profile.reportedModel = meta.reportedModel;
    const p = (this.phases[phase] ??= { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    p.turns++;
    p.input += usage?.inputTokens ?? 0;
    p.output += usage?.outputTokens ?? 0;
    p.cacheRead += usage?.cacheReadTokens ?? 0;
    p.cacheWrite += usage?.cacheWriteTokens ?? 0;
  }

  context(used: number): void {
    this.peak = Math.max(this.peak ?? 0, used);
  }

  report(base: Pick<RunReport, "folder" | "action" | "cost" | "notePath">): RunReport {
    return { ...base, ...this.profile, phases: this.phases, ...(this.peak !== undefined ? { peakContext: this.peak } : {}) };
  }
}

const n = (v: number) => v.toLocaleString("en-US");

/** Input and output over every phase; cache reads and writes are shown, not added. */
export function usedTokens(r: RunReport): number {
  return Object.values(r.phases).reduce((sum, p) => sum + p.input + p.output, 0);
}

/** Cache reads and writes over every phase, shown next to the verdict so it isn't read as the whole bill. */
export function cacheTokens(r: RunReport): { read: number; write: number } {
  return Object.values(r.phases).reduce((sum, p) => ({ read: sum.read + p.cacheRead, write: sum.write + p.cacheWrite }), { read: 0, write: 0 });
}

export function formatReport(r: RunReport): string {
  const lines = [
    "",
    "Report",
    `  tier          ${r.tier ?? "–"}`,
    `  model         ${r.model ?? "engine default"}${r.reportedModel ? ` (engine reported: ${r.reportedModel})` : ""}`,
    `  effort        ${r.effort ?? "–"}`,
    `  cap           ${r.cap ? `${n(r.cap)} tokens` : "–"}`,
    "",
    `  ${"phase".padEnd(12)}${"turns".padStart(6)}${"input".padStart(10)}${"output".padStart(10)}${"cache read".padStart(12)}${"cache write".padStart(13)}`,
  ];
  for (const phase of REPORT_PHASES) {
    const p = r.phases[phase];
    if (!p) continue;
    lines.push(`  ${phase.padEnd(12)}${String(p.turns).padStart(6)}${n(p.input).padStart(10)}${n(p.output).padStart(10)}${n(p.cacheRead).padStart(12)}${n(p.cacheWrite).padStart(13)}`);
  }
  lines.push("");
  if (r.peakContext !== undefined) {
    lines.push(`  peak context  ${n(r.peakContext)}${r.cap ? ` of ${n(r.cap)} (${Math.round((r.peakContext / r.cap) * 100)}%)` : ""}`);
  }
  const cache = cacheTokens(r);
  lines.push(
    `  verdict       used about ${n(usedTokens(r))} tokens (input+output, uncached), plus ${n(cache.read)} cache read and ${n(cache.write)} cache write; cost hint says ${r.cost}`,
  );
  lines.push(`  usage log     ${path.join(r.folder, ".harness", "usage.jsonl")}`);
  if (r.notePath) lines.push(`  note          ${r.notePath}`);
  return `${lines.join("\n")}\n`;
}
