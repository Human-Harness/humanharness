import type { AppState, PhaseView, TimeBoxView } from "./client";

/** The phases of `action`, in order; none without phases (D0). */
export function actionPhases(state: Pick<AppState, "actions">, action: string | undefined): PhaseView[] {
  return action !== undefined && Object.hasOwn(state.actions, action) ? (state.actions[action].phases ?? []) : [];
}

/** The `close: true` part among `phases` (always the last one, if any). */
export function closePhaseOf(phases: PhaseView[]): PhaseView | undefined {
  return phases.find((p) => p.close);
}

/** The modes allowed in `phase` among the action's `modes` (modes spec §7); all of them without a phase. */
export function phaseModesOf(modes: string[], phase: PhaseView | undefined): string[] {
  const allowed = phase?.modes;
  if (allowed === undefined || allowed === "any") return modes;
  if (allowed === "none") return [];
  return modes.filter((m) => allowed.includes(m));
}

/** The time left at `now` (ms since epoch): the view was measured at `at` and counts on unless paused. */
export function timeLeftMs(box: Pick<TimeBoxView, "totalMs" | "usedMs" | "at" | "paused">, now: number): number {
  const used = box.usedMs + (box.paused ? 0 : Math.max(0, now - Date.parse(box.at)));
  return Math.max(0, box.totalMs - used);
}
