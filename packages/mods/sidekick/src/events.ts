import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Spec §6.1: trimmed to the last 2,000 lines. */
export const SIDEKICK_EVENTS_MAX = 2000;
const TRIM_SLACK = 200;
const LAST_CARDS = 10;
const START = 0.5;
const RAISED = 0.8;
const LOW_SHARE = 0.2;
const WHY_MIN = 3;

/** The events line's own short moment names (spec §6.1), not the SDK's `SidekickMoment`. */
export type SidekickEventMoment = "pre" | "after" | "heads-up" | "before-approve" | "phase-change" | "daily" | "place";
export type SidekickOutcome = "used" | "edited" | "sent-anyway" | "dismissed" | "muted" | "timeout";

export interface SidekickEvent {
  at: string;
  task?: string;
  scope?: string;
  action?: string;
  sidekick: string;
  moment: SidekickEventMoment;
  kind: string;
  outcome: SidekickOutcome;
  confidence?: number;
}

/** Not tracked by the history, never leaves the machine (spec §6.1). */
export const sidekickEventsFile = (base: string): string => path.join(base, ".harness", "sidekick", "events.jsonl");

export async function readSidekickEvents(base: string): Promise<SidekickEvent[]> {
  const raw = await fs.readFile(sidekickEventsFile(base), "utf8").catch(() => "");
  const out: SidekickEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as SidekickEvent;
      if (e && typeof e.sidekick === "string" && typeof e.kind === "string" && typeof e.outcome === "string") out.push(e);
    } catch {
      // a broken line is skipped
    }
  }
  return out.slice(-SIDEKICK_EVENTS_MAX);
}

/** Appends one event; past the limit (with some slack, so it isn't rewritten every time) keeps the last 2,000. */
export async function appendSidekickEvent(base: string, e: SidekickEvent): Promise<void> {
  const file = sidekickEventsFile(base);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(e) + "\n");
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length <= SIDEKICK_EVENTS_MAX + TRIM_SLACK) return;
  const kept = (await readSidekickEvents(base)).map((x) => JSON.stringify(x));
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, kept.join("\n") + "\n");
  await fs.rename(tmp, file);
}

const isCard = (e: SidekickEvent) => e.outcome !== "timeout";
const isUsed = (e: SidekickEvent) => e.outcome === "used" || e.outcome === "edited";
const lastCards = (events: readonly SidekickEvent[], sidekick: string, kind: string) =>
  events.filter((e) => e.sidekick === sidekick && e.kind === kind && isCard(e)).slice(-LAST_CARDS);

/** The show threshold of `kind` for `sidekick` (spec §6.2): 0.8 when under 20% of its last 10 cards were used. */
export function thresholdFor(events: readonly SidekickEvent[], sidekick: string, kind: string): number {
  const cards = lastCards(events, sidekick, kind);
  if (cards.length < LAST_CARDS) return START;
  return cards.filter(isUsed).length / cards.length < LOW_SHARE ? RAISED : START;
}

/** "N of M suggestions used" (spec §8), over the given events. */
export function usedShare(events: readonly SidekickEvent[]): { used: number; of: number } {
  const cards = events.filter(isCard);
  return { used: cards.filter(isUsed).length, of: cards.length };
}

/** Why a card shows (spec §4.1 step 4): how often this sidekick's `kind` suggestions were taken lately; null with fewer than 3. */
export function whyShown(events: readonly SidekickEvent[], sidekick: string, kind: string): { kind: string; used: number; of: number } | null {
  const cards = lastCards(events, sidekick, kind);
  return cards.length < WHY_MIN ? null : { kind, used: cards.filter(isUsed).length, of: cards.length };
}
