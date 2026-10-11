import type { ActionCost } from "@humanharness/harness-sdk";
import type { ChatEntry, LimitWindow, TurnUsage } from "./client";

/** Meter warnings (spec §6): close to the limit, and almost out. */
export const WARN_AT = 0.8;
export const HIGH_AT = 0.95;
/** Share of the five-hour window assumed for a heavy action before the log has a measurement. */
export const HEAVY_DEFAULT = 0.1;

export const percent = (share: number): number => Math.round(Math.min(1, Math.max(0, share)) * 100);

/**
 * All of a reply's tokens. `inputTokens` excludes cached input for both transports (Claude's
 * `input_tokens`; codex-acp subtracts cached and cache-write input before reporting), so adding the
 * cache counts doesn't count them twice.
 */
export const totalTokens = (u: TurnUsage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/** Tokens of the latest reply that reported any. */
export function lastTurnTokens(entries: ChatEntry[]): number | null {
  const entry = entries.findLast((e) => e.role === "assistant" && e.usage);
  return entry?.usage ? totalTokens(entry.usage) : null;
}

/** "85.4K"-style token count in the UI language. */
export function compactTokens(n: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** When a window resets: the time if it's within the day, otherwise the weekday and time. */
export function formatReset(iso: string, language: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return date.getTime() - now.getTime() < 20 * 3600_000
    ? date.toLocaleTimeString(language, time)
    : date.toLocaleString(language, { weekday: "short", ...time });
}

/** The windows that haven't reset yet (a reset window's utilization no longer says anything). */
export function currentWindows(limits: LimitWindow[] | null, now: number = Date.now()): LimitWindow[] | null {
  return limits ? limits.filter((w) => Date.parse(w.resetsAt) > now) : null;
}

export const fiveHour = (limits: LimitWindow[] | null, now: number = Date.now()): LimitWindow | undefined =>
  currentWindows(limits, now)?.find((w) => w.kind === "five_hour");

/** The window an out-of-quota card should mention: the fullest, and among those the one that resets last. */
export function resetWindow(limits: LimitWindow[] | null, now: number = Date.now()): LimitWindow | undefined {
  const current = currentWindows(limits, now);
  if (!current?.length) return undefined;
  return [...current].sort((a, b) => b.utilization - a.utilization || Date.parse(b.resetsAt) - Date.parse(a.resetsAt))[0];
}

export interface Preflight {
  /** Measured share of the five-hour window this action usually uses; null before there is one. */
  estimate: number | null;
  /** Share of the five-hour window left. */
  left: number;
}

/**
 * Whether to ask before an action: only heavy ones, only when the engine reports a five-hour window,
 * and only when the action would likely take it to WARN_AT or beyond. Null means go ahead.
 */
export function preflight(
  cost: ActionCost | undefined,
  limits: LimitWindow[] | null,
  estimate: number | undefined,
  now: number = Date.now(),
): Preflight | null {
  if (cost !== "heavy") return null;
  const window = fiveHour(limits, now);
  if (!window) return null;
  if (window.utilization + (estimate ?? HEAVY_DEFAULT) < WARN_AT) return null;
  return { estimate: estimate ?? null, left: Math.max(0, 1 - window.utilization) };
}
