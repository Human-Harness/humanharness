import type { HarnessAction, HarnessPhase } from "./index";

/** A phase id (task-phases spec §3): the action id pattern, unique within its action. */
export const PHASE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** The longest time box a manifest may offer, in minutes. */
export const TIME_BOX_MAX = 240;

/** Some action declares phases: only then the core offers `set_phase` (D0). */
export const hasPhases = (h: { actions: Record<string, { phases?: readonly unknown[] }> }): boolean =>
  Object.values(h.actions).some((a) => (a.phases?.length ?? 0) > 0);

/** Every phase id the harness declares, in action order, once each: what the `ui` server accepts in `set_phase`. */
export function phaseIds(h: { actions: Record<string, { phases?: readonly { id: string }[] }> }): string[] {
  return [...new Set(Object.values(h.actions).flatMap((a) => (a.phases ?? []).map((p) => p.id)))];
}

/** The modes allowed in `phase` (modes spec §7): absent or "any", all the action's; "none", none; a list, those. */
export function phaseModes(action: Pick<HarnessAction, "modes">, phase: Pick<HarnessPhase, "modes"> | undefined): string[] {
  const all = action.modes ?? [];
  const allowed = phase?.modes;
  if (allowed === undefined || allowed === "any") return all;
  if (allowed === "none") return [];
  return all.filter((m) => allowed.includes(m));
}
