import { type HarnessMaterial, hasMaterial } from "@humanharness/harness-sdk";
import { MAX_PAGES } from "@humanharness/material/light";
import type { MaterialInfo, MaterialResult } from "@humanharness/ui/client";
import { DATA_PREFIX, type HistoryKeep, MATERIAL_KEEP, NOTES_PREFIX } from "@humanharness/workspace";

// The material pieces of the main process that every harness runs at start: small and free of the material service
// (loaded only when the harness has material), so a harness without it gets exactly today's lists and state (D0).

/** What the history keeps under `.harness/`: notes and data; with material, its registry and decisions (material spec §4). */
export const historyKeep = (h: { material?: unknown }): HistoryKeep[] => [NOTES_PREFIX, DATA_PREFIX, ...(hasMaterial(h) ? [MATERIAL_KEEP] : [])];

/** `AppState`'s `material`, spread in: nothing at all without material (D0). */
export const materialAppState = (h: { material?: Pick<HarnessMaterial, "accepts" | "items" | "grounding"> }): { material?: MaterialInfo } =>
  h.material ? { material: { accepts: [...h.material.accepts], items: h.material.items !== undefined, grounding: h.material.grounding, maxPages: MAX_PAGES } } : {};

/**
 * `hh:materialOpen`: opens the original of a source or a fragment's source. "not-ready" without material, "unknown-source"
 * for an id (or scope) that names no original, "invalid" when the system could not open it.
 */
export async function openMaterial(
  svc: { originalOf(scope: unknown, id: unknown): Promise<string | null> } | null,
  scope: unknown,
  id: unknown,
  openPath: (file: string) => Promise<string>,
): Promise<MaterialResult> {
  if (!svc) return { ok: false, reason: "not-ready" };
  const file = await svc.originalOf(scope, id);
  if (!file) return { ok: false, reason: "unknown-source" };
  return (await openPath(file)) ? { ok: false, reason: "invalid" } : { ok: true };
}
