import type { HarnessAction } from "./index";

/** A mode id (task-modes spec §3): the action id pattern. Never a dot, so `<mode>.<field>` names a mode setting. */
export const MODE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** What an action's `defaultMode` may say besides one of its modes. No mode may take these ids. */
export const DEFAULT_MODE_WORDS: readonly string[] = ["recommend", "ask"];

/** The harness declares at least one mode. False: everything stays as before (D0). */
export const hasModes = (h: { modes?: Record<string, unknown> }): boolean => Object.keys(h.modes ?? {}).length > 0;

/**
 * How a task of `action` starts (spec §3 `defaultMode`): one of its modes, "recommend" (the default: D2, the AI
 * recommends, the person decides) or "ask". Null when the action has no modes (D0).
 */
export function defaultModeOf(action: Pick<HarnessAction, "modes" | "defaultMode">): string | null {
  if (!action.modes || action.modes.length === 0) return null;
  return action.defaultMode ?? "recommend";
}
