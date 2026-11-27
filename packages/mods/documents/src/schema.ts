// The config a harness gives the documents mod under `mods.documents`: its schema and what reads it.
import { DOCUMENT_KIND_ID } from "@humanharness/harness-sdk/documents";
import { z } from "zod";

/** A line of text a kind adds to AGENTS.md. */
const oneLine = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n]*$/, "Use one line, without line breaks");

const documentKindSchema = z.object({
  when: oneLine(300),
  sections: z.array(oneLine(120)).min(1).max(20),
  status: z.array(oneLine(40)).min(1).max(10).optional(),
  /**
   * The tier of a "Review <title>" task for this kind (review spec §11.3). Absent: standard. These are the manifest's
   * TIERS, written out: harness-sdk's index re-exports this file, so importing them from it would be a cycle.
   */
  reviewTier: z.enum(["light", "standard", "deep"]).optional(),
});
const MAX_DOCUMENT_KINDS = 20;

/** Document kinds with a template of required `##` sections. Absent: only the base writing guide (D0). */
export const documentsSchema = z
  .object({
    kinds: z
      .record(z.string().max(64, "A kind id has at most 64 characters").regex(DOCUMENT_KIND_ID, "A kind id is lowercase letters, digits and -"), documentKindSchema)
      .refine((k) => Object.keys(k).length <= MAX_DOCUMENT_KINDS, { message: `At most ${MAX_DOCUMENT_KINDS} document kinds` }),
  })
  .superRefine((d, ctx) => {
    // Document kinds (document-reader spec §4.2): a section named twice could never be told apart by the check.
    for (const [id, kind] of Object.entries(d.kinds)) {
      for (const [key, values] of [["sections", kind.sections], ["status", kind.status ?? []]] as const) {
        const seen = new Set<string>();
        values.forEach((s, i) => {
          const k = key === "sections" ? s.trim().toLowerCase() : s.toLowerCase();
          if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["kinds", id, key, i], message: `"${s}" is listed twice` });
          seen.add(k);
        });
      }
    }
  });
export type DocumentsConfig = z.output<typeof documentsSchema>;

/**
 * The harness's `mods.documents` config, parsed; undefined when the harness gives none, also with the bare `{}` that
 * only declares the mod.
 */
export function documentsConfig(h: { mods?: Record<string, Record<string, unknown>> }): DocumentsConfig | undefined {
  const raw = h.mods?.documents;
  return raw === undefined || Object.keys(raw).length === 0 ? undefined : documentsSchema.parse(raw);
}
