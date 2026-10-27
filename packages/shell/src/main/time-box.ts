import type { TimeBoxState } from "./task-store";

/** A real minute. Tests and mock mode pass a shorter one (`TaskDeps.minuteMs`). */
export const MINUTE_MS = 60_000;
/** What "+5 min" adds (spec §5 `extendTimeBox`). */
export const EXTEND_MINUTES = 5;

/** Time counted so far: what was folded in, plus the running stretch. */
export function usedMs(t: TimeBoxState, now: Date): number {
  return t.usedMs + (t.runningSince ? Math.max(0, now.getTime() - Date.parse(t.runningSince)) : 0);
}

/** Time left, never below zero. */
export function remainingMs(t: TimeBoxState, now: Date, minute = MINUTE_MS): number {
  return Math.max(0, t.minutes * minute - usedMs(t, now));
}

/** The box with the running stretch folded in and the clock stopped (pause, quit). */
export function paused(t: TimeBoxState, now: Date): TimeBoxState {
  if (!t.runningSince) return t;
  const { runningSince: _since, ...rest } = t;
  return { ...rest, usedMs: usedMs(t, now) };
}

/** The box with the clock running from `now` (resume). */
export function running(t: TimeBoxState, now: Date): TimeBoxState {
  return t.runningSince ? t : { ...t, runningSince: now.toISOString() };
}

/**
 * The next step and how far away it is: the wrap-up at `wrapUpAt` of the time (absent: at the end), then the end.
 * Null once both ran.
 */
export function nextDue(t: TimeBoxState, wrapUpAt: number | undefined, now: Date, minute = MINUTE_MS): { kind: "wrap-up" | "end"; inMs: number } | null {
  const total = t.minutes * minute;
  const used = usedMs(t, now);
  if (!t.wrappedUp) return { kind: "wrap-up", inMs: Math.max(0, (wrapUpAt ?? 1) * total - used) };
  if (!t.ended) return { kind: "end", inMs: Math.max(0, total - used) };
  return null;
}

/** The time left as a prompt says it ("about 12 minutes"). */
export function formatTimeLeft(ms: number, minute = MINUTE_MS): string {
  if (ms <= 0) return "none";
  const m = Math.ceil(ms / minute);
  return m <= 1 ? "about 1 minute" : `about ${m} minutes`;
}
