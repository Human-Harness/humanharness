import { z } from "zod";

/** The kinds of files the core reads (material spec §3). A harness may accept fewer. */
export const MATERIAL_FAMILIES = ["pdf", "word", "spreadsheet", "presentation", "ebook", "web", "text"] as const;
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];
/** How a task in a scope uses its material (§9 "Ground"). */
export const GROUNDING_MODES = ["strict", "mixed"] as const;
export type GroundingMode = (typeof GROUNDING_MODES)[number];
/** The AI stages, in the order they run (§6.2, §8). */
export const MATERIAL_STAGES = ["review", "repair", "label", "sheet", "link"] as const;
export type MaterialStage = (typeof MATERIAL_STAGES)[number];
/** The two sections every sheet gets from the core (§8). */
export const CORE_SHEET_SECTIONS = { notation: "Notation and conventions", "not-covered": "What the material does not cover" } as const;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
/** The tiers (index.ts `TIERS`; repeated here to avoid an import cycle, and tested to match). */
const tier = z.enum(["light", "standard", "deep"]);
type StageTier = z.output<typeof tier>;
/** What each stage runs at unless the harness says otherwise (§6.2: review standard, repairs light; §8). */
export const DEFAULT_STAGE_TIERS: Record<MaterialStage, StageTier> = { review: "standard", repair: "light", label: "light", sheet: "light", link: "standard" };

/** The key a stage's model setting lives under in `config.json` → `models.tasks`, next to the action ids. */
export const materialStageKey = (stage: MaterialStage): string => `material-${stage}`;
export const MATERIAL_STAGE_KEYS: readonly string[] = MATERIAL_STAGES.map(materialStageKey);

const sectionSchema = z.object({
  id: z.string().regex(ID),
  /** The heading the sheet shows (English). */
  label: z.string().min(1).max(80),
  /** What the AI writes in it (English). */
  prompt: z.string().min(1).max(400),
});

/** The manifest's `material` (§8). The rules that need the whole manifest are in its superRefine. */
export const materialSchema = z.object({
  accepts: z.array(z.enum(MATERIAL_FAMILIES)).min(1).default([...MATERIAL_FAMILIES]),
  sheet: z.object({ sections: z.array(sectionSchema).min(1).max(8), maxTokens: z.number().int().min(200).max(3000).default(800) }),
  fragmentKinds: z.array(z.string().regex(ID)).min(1).max(12).default(["explanation", "definition", "example", "exercise"]),
  /** Where the harness keeps the things fragments link to; absent: no linking stage. */
  items: z.object({ collection: z.string().min(1), label: z.string().min(1) }).optional(),
  grounding: z
    .object({ default: z.enum(GROUNDING_MODES).default("mixed"), personCanChange: z.boolean().default(true) })
    .default({ default: "mixed", personCanChange: true }),
  budget: z.object({ indexTokens: z.number().int().min(100).max(3000).default(600) }).default({ indexTokens: 600 }),
  tiers: z.object({ review: tier.optional(), repair: tier.optional(), label: tier.optional(), sheet: tier.optional(), link: tier.optional() }).default({}),
});
export type HarnessMaterial = z.output<typeof materialSchema>;

/** Whether the harness takes material; without it nothing of this feature exists (D0). */
export const hasMaterial = (h: { material?: unknown }): boolean => h.material !== undefined;

/** The tier a stage runs at: the harness's override, else the core's. */
export const stageTier = (m: Pick<HarnessMaterial, "tiers">, stage: MaterialStage): StageTier => m.tiers[stage] ?? DEFAULT_STAGE_TIERS[stage];
