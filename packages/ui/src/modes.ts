import type { Tier } from "@humanharness/harness-sdk";
import type { AppState } from "./client";

/** The window's own copy of the tier order (the sdk's `tierBelow` lives on the main side of the bundle). */
const ORDER: Tier[] = ["light", "standard", "deep"];

/** `a` is a lower tier than `b`. */
export const tierBelow = (a: Tier, b: Tier): boolean => ORDER.indexOf(a) < ORDER.indexOf(b);

/** A mode as the window lists it. */
export interface ModeOption {
  id: string;
  label: string;
  description?: string;
  minTier?: Tier;
}

/** The modes a task of `action` may work in, in the action's order; none without modes (D0). */
export function actionModes(state: Pick<AppState, "actions" | "modes">, action: string | undefined): ModeOption[] {
  const modes = state.modes;
  if (!modes || action === undefined || !Object.hasOwn(state.actions, action)) return [];
  return (state.actions[action].modes ?? []).flatMap((id) => (Object.hasOwn(modes, id) ? [{ id, ...modes[id] }] : []));
}

/** A `recommend_mode` block's data, as the window may trust it. */
export interface Recommendation {
  recommended: string;
  reasons: string[];
  alternatives: { mode: string; why: string }[];
}

/**
 * The block's data, keeping only well-formed fields (the agent wrote them) and modes in `allowed` (the action's).
 * Null when the recommended mode isn't one of them or there is no reason left.
 */
export function readRecommendation(data: unknown, allowed: string[]): Recommendation | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { recommended?: unknown; reasons?: unknown; alternatives?: unknown };
  if (typeof d.recommended !== "string" || !allowed.includes(d.recommended)) return null;
  const reasons = (Array.isArray(d.reasons) ? d.reasons : []).filter((r): r is string => typeof r === "string" && r.length > 0).slice(0, 3);
  if (reasons.length === 0) return null;
  const seen = new Set([d.recommended]);
  const alternatives: Recommendation["alternatives"] = [];
  for (const a of Array.isArray(d.alternatives) ? d.alternatives : []) {
    const x = (a ?? {}) as { mode?: unknown; why?: unknown };
    if (typeof x.mode !== "string" || !allowed.includes(x.mode) || seen.has(x.mode)) continue;
    if (typeof x.why !== "string" || !x.why) continue;
    seen.add(x.mode);
    alternatives.push({ mode: x.mode, why: x.why });
    if (alternatives.length === 2) break;
  }
  return { recommended: d.recommended, reasons, alternatives };
}
