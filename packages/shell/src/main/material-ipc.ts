import path from "node:path";
import { type Collection, type HarnessMaterial, MATERIAL_STAGES, type Tier, hasEnginePresets, hasMaterial, materialStageKey, stageTier } from "@humanharness/harness-sdk";
import { LINK_MAX_ITEMS, type LinkItem, MAX_PAGES } from "@humanharness/material/light";
import type { MaterialInfo, MaterialResult } from "@humanharness/ui/client";
import { type HistoryKeep, appHistoryKeep } from "@humanharness/workspace";

// The material pieces of the main process that every harness runs at start: small and free of the material service
// (loaded only when the harness has material), so a harness without it gets exactly today's lists and state (D0).

/**
 * What the history keeps under `.harness/`: notes and data; with material, its registry and decisions (material spec
 * §4); with `enginePresets`, the scopes' engine config (hatches spec §5.1).
 */
export const historyKeep = (h: { material?: unknown; enginePresets?: boolean }): HistoryKeep[] => appHistoryKeep(hasMaterial(h), hasEnginePresets(h));

/** `AppState`'s `material`, spread in: nothing at all without material (D0). */
export const materialAppState = (h: { material?: Pick<HarnessMaterial, "accepts" | "items" | "grounding"> }): { material?: MaterialInfo } =>
  h.material ? { material: { accepts: [...h.material.accepts], items: h.material.items !== undefined, grounding: h.material.grounding, maxPages: MAX_PAGES } } : {};

/**
 * Originals the system may open with their app: documents only. Anything else the person added keeps its name and may
 * be a script (`.command`, `.sh`, `.bat`, `.js`…) that opening would run; a saved web page (`.html`) would run its
 * scripts from `file://`. Those are shown in Finder instead.
 */
export const MATERIAL_OPENABLE: ReadonlySet<string> = new Set([
  ".pdf", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".epub", ".rtf", ".txt", ".md", ".markdown", ".csv", ".tsv",
]);

/** Whether an original opens with its app (else it is only shown in Finder). */
export function materialOpens(file: string): boolean {
  const name = path.basename(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 && MATERIAL_OPENABLE.has(name.slice(dot).toLowerCase());
}

/**
 * `hh:materialOpen`: opens the original of a source or a fragment's source when it is a document
 * (`MATERIAL_OPENABLE`), else shows it in Finder. "not-ready" without material, "unknown-source" for an id (or scope)
 * that names no original, "invalid" when the system could not open it.
 */
export async function openMaterial(
  svc: { originalOf(scope: unknown, id: unknown): Promise<string | null> } | null,
  scope: unknown,
  id: unknown,
  openPath: (file: string) => Promise<string>,
  reveal: (file: string) => void,
): Promise<MaterialResult> {
  if (!svc) return { ok: false, reason: "not-ready" };
  const file = await svc.originalOf(scope, id);
  if (!file) return { ok: false, reason: "unknown-source" };
  if (!materialOpens(file)) {
    reveal(file);
    return { ok: true };
  }
  return (await openPath(file)) ? { ok: false, reason: "invalid" } : { ok: true };
}

/** The part of the data store the items are read through. */
export interface ItemsStore {
  scopeFor(name: string, scope: string): string;
  readAll(name: string, scope: string): Promise<{ records: Record<string, unknown>[] }>;
}

/** Settings › Models' recommendation for each material stage, by its reserved id; the links stage only with items (§8). */
export const materialRecommended = (m: Pick<HarnessMaterial, "tiers" | "items">): Record<string, Tier> =>
  Object.fromEntries(MATERIAL_STAGES.filter((s) => s !== "link" || m.items).map((s) => [materialStageKey(s), stageTier(m, s)]));

/**
 * The links stage's items (material spec §8): the first LINK_MAX_ITEMS records of the `items` collection in the
 * scope (or the app-wide one), as `key: label`, the label cut to 200 characters (the key when it has none). Empty for
 * a collection hidden from the agent (its labels would reach the engine's provider), one with no key, no store yet,
 * or a read that fails: never throws.
 */
export async function materialItems(
  items: HarnessMaterial["items"],
  data: Record<string, Pick<Collection, "key" | "agent">>,
  store: () => Promise<ItemsStore | null>,
  scope: string,
): Promise<LinkItem[]> {
  if (!items || !Object.hasOwn(data, items.collection)) return [];
  const c = data[items.collection];
  const key = c.key;
  if (!key || c.agent === "none") return [];
  const text = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);
  try {
    const s = await store();
    if (!s) return [];
    const { records } = await s.readAll(items.collection, s.scopeFor(items.collection, scope));
    const out: LinkItem[] = [];
    for (const r of records) {
      if (out.length >= LINK_MAX_ITEMS) break;
      const k = text(r[key]);
      if (k === null) continue;
      out.push({ key: k, label: (text(r[items.label]) ?? k).slice(0, 200) });
    }
    return out;
  } catch (err) {
    console.error("Could not read the material's items", err);
    return [];
  }
}
