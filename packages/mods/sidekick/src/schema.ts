// The config a harness gives Sidekick under `mods.sidekick`: its schema and what reads it.
import { z } from "zod";
import {
  PLACE_ID,
  SIDEKICK_ACTION_MODES,
  SIDEKICK_MIN_WORDS,
  SIDEKICK_PERSONALITY_MAX,
  SIDEKICK_PURPOSES,
  type SidekickActionMode,
  type SidekickPurpose,
  markSchema,
  purposeSchema,
} from "./manifest";

/** A harness place a sidekick can be asked about (spec §2a.5); its id follows the action-id pattern. */
const placeSchema = z.strictObject({ id: z.string().regex(PLACE_ID), label: z.string().min(1).max(40), description: z.string().min(1).max(300) });
/** A ready-made sidekick the harness offers (spec §2a.7). */
const presetSchema = z.strictObject({
  name: z.string().min(1).max(40),
  mark: markSchema,
  personality: z.string().max(SIDEKICK_PERSONALITY_MAX),
  purposes: z.array(purposeSchema).min(1).max(6),
});

const tipText = z.string().min(1).max(4000);

/** The harness's `mods.sidekick` config (spec §3). Absent: no Sidekick in this harness; `{}` gives it with the defaults. */
export const sidekickSchema = z
  .strictObject({
    /** The state for a new profile. */
    default: z.enum(["on", "off"]).default("off"),
    /** Domain hints appended to the brief, in English; one text, or one per purpose. */
    tips: z.union([tipText, z.partialRecord(z.enum(SIDEKICK_PURPOSES), tipText)]).optional(),
    /** The pre-send mode per action id; free questions and unlisted actions are `auto`. */
    actions: z.record(z.string(), z.enum(SIDEKICK_ACTION_MODES)).optional(),
    /** Local-check thresholds (spec §4.1); unknown keys are refused. */
    checks: z.strictObject({ minWords: z.number().int().min(1).max(50).optional() }).optional(),
    /** Places a sidekick can be asked about (spec §2a.5); ids unique. */
    places: z.array(placeSchema).max(12).optional(),
    /** Ready-made sidekicks offered to the person (spec §2a.7); names unique (adopting one finds it by name). */
    presets: z.array(presetSchema).max(8).optional(),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    for (const [i, p] of (s.places ?? []).entries()) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: ["places", i, "id"], message: `Place ids must be unique: "${p.id}"` });
      ids.add(p.id);
    }
    const names = new Set<string>();
    for (const [i, preset] of (s.presets ?? []).entries()) {
      if (names.has(preset.name)) ctx.addIssue({ code: "custom", path: ["presets", i, "name"], message: `Preset names must be unique: "${preset.name}"` });
      names.add(preset.name);
      for (const [j, purpose] of preset.purposes.entries()) {
        if (purpose.id !== "custom") continue;
        for (const m of purpose.moments) {
          if (m.startsWith("place:") && !ids.has(m.slice(6))) ctx.addIssue({ code: "custom", path: ["presets", i, "purposes", j, "moments"], message: `"${m}" names no place of this harness` });
        }
      }
    }
  });
export type SidekickManifest = z.output<typeof sidekickSchema>;

/** The tips for `purpose`: the single text for every purpose, or that purpose's own. */
export function sidekickTips(m: SidekickManifest | undefined, purpose: SidekickPurpose = "prompt-coach"): string | undefined {
  const tips = m?.tips;
  if (tips === undefined) return undefined;
  return typeof tips === "string" ? tips : tips[purpose];
}

/** The pre-send mode of `action` (free questions: undefined → `auto`). */
export function sidekickMode(m: SidekickManifest | undefined, action: string | undefined): SidekickActionMode {
  if (action === undefined || !m?.actions || !Object.hasOwn(m.actions, action)) return "auto";
  return m.actions[action];
}

/** The local check's word threshold: the manifest's `checks.minWords`, or the core's. */
export const sidekickMinWords = (m: SidekickManifest | undefined): number => m?.checks?.minWords ?? SIDEKICK_MIN_WORDS;
