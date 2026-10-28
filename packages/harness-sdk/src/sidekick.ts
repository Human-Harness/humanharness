import { z } from "zod";
import { type Collection, collectionSchema } from "./data";

/** The process key of Sidekick's turns in Settings › Models (`models.tasks`) and its reserved action id (spec §5). */
export const SIDEKICK_PROCESS = "sidekick";
/** The reserved app-wide collection that holds Sidekick's settings (and, in part 2, its learned items and records). */
export const SIDEKICK_COLLECTION = "sidekick";
/** Over this many tokens, `humanharness check` warns about the manifest's tips (spec §3). */
export const SIDEKICK_TIPS_TOKENS_WARN = 300;
/** Below this many words a prompt with a vague word is flagged (spec §4.1); `checks.minWords` overrides it. */
export const SIDEKICK_MIN_WORDS = 6;

/** The core's purposes (spec §2a.2). Part 1 uses only `prompt-coach`. */
export const SIDEKICK_PURPOSES = ["prompt-coach", "focus", "process-guard", "mentor", "daily-summary", "custom"] as const;
export type SidekickPurpose = (typeof SIDEKICK_PURPOSES)[number];

/** How an action's prompts are reviewed before they go out (spec §3). */
export const SIDEKICK_ACTION_MODES = ["auto", "always", "off"] as const;
export type SidekickActionMode = (typeof SIDEKICK_ACTION_MODES)[number];

/** When a sidekick speaks (spec §2a.1). `place:<id>` is a harness place (§2a.5). */
export const SIDEKICK_MOMENTS = ["pre-send", "after-reply", "heads-up", "before-approve", "phase-change", "daily"] as const;
export type SidekickMoment = (typeof SIDEKICK_MOMENTS)[number] | `place:${string}`;
const PLACE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
export const isMoment = (v: unknown): v is SidekickMoment =>
  typeof v === "string" && ((SIDEKICK_MOMENTS as readonly string[]).includes(v) || (v.startsWith("place:") && PLACE_ID.test(v.slice(6))));

export const SIDEKICK_PERSONALITY_MAX = 1500;
export const SIDEKICK_PURPOSE_TEXT_MAX = 600;
/** How many kinds one sidekick may have muted (spec §6.3): every flag, after-reply, heads-up, guard and daily kind fits. */
export const SIDEKICK_MUTED_MAX = 20;

type CorePurpose = Exclude<SidekickPurpose, "custom">;
/** The core's purposes and their moments (spec §2a.2). */
export const PURPOSE_MOMENTS: Record<CorePurpose, readonly SidekickMoment[]> = {
  "prompt-coach": ["pre-send", "after-reply"],
  focus: ["heads-up"],
  "process-guard": ["before-approve", "phase-change"],
  mentor: ["after-reply"],
  "daily-summary": ["daily"],
};

/** One purpose of a sidekick: a core one, or `custom` with its own text and moments. */
export const purposeSchema = z.union([
  z.strictObject({ id: z.enum(["prompt-coach", "focus", "process-guard", "mentor", "daily-summary"]) }),
  z.strictObject({
    id: z.literal("custom"),
    text: z.string().min(1).max(SIDEKICK_PURPOSE_TEXT_MAX),
    moments: z.array(z.string().refine(isMoment, "Unknown moment")).min(1).max(7),
  }),
]);
export type SidekickPurposeDef = z.output<typeof purposeSchema>;

/** The moments a purpose speaks at. */
export const purposeMoments = (p: SidekickPurposeDef): readonly SidekickMoment[] => (p.id === "custom" ? (p.moments as SidekickMoment[]) : PURPOSE_MOMENTS[p.id]);

/** A harness place a sidekick can be asked about (spec §2a.5); its id follows the action-id pattern. */
const placeSchema = z.strictObject({ id: z.string().regex(PLACE_ID), label: z.string().min(1).max(40), description: z.string().min(1).max(300) });
/** A ready-made sidekick the harness offers (spec §2a.7). */
const presetSchema = z.strictObject({
  name: z.string().min(1).max(40),
  mark: z.string().min(1).max(16),
  personality: z.string().max(SIDEKICK_PERSONALITY_MAX),
  purposes: z.array(purposeSchema).min(1).max(6),
});

const tipText = z.string().min(1).max(4000);

/** The manifest's `sidekick` block (spec §3). Absent: Sidekick is available, default off, no tips. */
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

/** Longest wait before a prompt goes out as typed (spec §4.1 step 5); "always" waits up to SIDEKICK_ALWAYS_MAX_MS. */
export const SIDEKICK_WAITS = [6, 10, "always"] as const;
export type SidekickWait = (typeof SIDEKICK_WAITS)[number];
/** Sidekick's tokens per task (spec §8). */
export const SIDEKICK_CAPS = [20_000, 50_000, "none"] as const;
export type SidekickCap = (typeof SIDEKICK_CAPS)[number];
export const SIDEKICK_ALWAYS_MAX_MS = 60_000;
/** The id of the one settings record. */
export const SIDEKICK_SETTINGS_ID = "settings";

const literalOf = <const T extends readonly [string | number, string | number, ...(string | number)[]]>(values: T) =>
  z.union(values.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<T[number]>, z.ZodLiteral<T[number]>, ...z.ZodLiteral<T[number]>[]]);

const ISO = z.string().min(10).max(40);
export const SIDEKICK_RECORD_TYPES = ["settings", "learned", "sidekick", "scope"] as const;
export type SidekickRecordType = (typeof SIDEKICK_RECORD_TYPES)[number];
const importSource = z.union([
  z.strictObject({ kind: z.literal("paste") }),
  z.strictObject({ kind: z.literal("files"), paths: z.array(z.string().max(1024)).min(1).max(4), hash: z.string().regex(/^[0-9a-f]{64}$/) }),
]);

/**
 * A record of the `sidekick` collection: `settings` (one, id "settings"), `learned` items, `sidekick` definitions and
 * per-`scope` records, all in one object (one ZodObject, as collections need); each type's required fields are checked
 * below. Only changed settings are stored.
 */
export const sidekickRecordSchema = z
  .strictObject({
    id: z.string().min(1).max(80),
    type: z.enum(SIDEKICK_RECORD_TYPES),
    // settings (scope records reuse `on`)
    on: z.boolean().optional(),
    preSend: z.boolean().optional(),
    afterReply: z.boolean().optional(),
    headsUps: z.boolean().optional(),
    wait: literalOf(SIDEKICK_WAITS).optional(),
    cap: literalOf(SIDEKICK_CAPS).optional(),
    /** The off-state intro card was answered (Turn on / Not now). */
    introSeen: z.boolean().optional(),
    /** The harness's presets were offered once (spec §2a.7). */
    presetsOffered: z.boolean().optional(),
    /** Muted kinds per sidekick id (spec §6.3). */
    muted: z.record(z.string(), z.array(z.string().max(40)).max(SIDEKICK_MUTED_MAX)).optional(),
    /** When learning last ran (spec §6.4). */
    learnedAt: ISO.optional(),
    /** The local day the daily card last ran (YYYY-MM-DD). */
    lastDaily: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // learned (and `source` for an imported sidekick)
    text: z.string().min(1).max(300).optional(),
    level: z.enum(["you", "harness"]).optional(),
    kind: z.string().max(40).optional(),
    source: z.union([z.enum(["learned", "person"]), importSource]).optional(),
    updatedAt: ISO.optional(),
    // sidekick
    name: z.string().min(1).max(40).optional(),
    mark: z.string().min(1).max(16).optional(),
    personality: z.string().max(SIDEKICK_PERSONALITY_MAX).optional(),
    purposes: z.array(purposeSchema).min(1).max(6).optional(),
    order: z.number().int().min(0).max(999).optional(),
    tier: z.enum(["light", "standard", "deep"]).optional(),
    /** The preset name it was adopted from (§2a.7). */
    preset: z.string().max(40).optional(),
    /** On in a scope with no scope record (§2a.1, §2a.4); absent = true. */
    defaultOn: z.boolean().optional(),
    // scope
    scope: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
    sidekick: z.string().max(80).optional(),
    purposeText: z.string().max(SIDEKICK_PURPOSE_TEXT_MAX).optional(),
    places: z.array(z.string().regex(PLACE_ID)).max(12).optional(),
  })
  .superRefine((r, ctx) => {
    const need = (fields: (keyof typeof r)[]) => {
      for (const f of fields) if (r[f] === undefined) ctx.addIssue({ code: "custom", path: [f], message: `A ${r.type} record needs "${f}"` });
    };
    if ((r.type === "settings") !== (r.id === SIDEKICK_SETTINGS_ID)) ctx.addIssue({ code: "custom", path: ["id"], message: `Only the settings record's id is "${SIDEKICK_SETTINGS_ID}"` });
    if (r.type === "learned") {
      need(["text", "level", "source", "updatedAt"]);
      if (typeof r.source === "object") ctx.addIssue({ code: "custom", path: ["source"], message: 'A learned item\'s source is "learned" or "person"' });
    }
    if (r.type === "sidekick") {
      need(["name", "mark", "personality", "purposes", "order"]);
      if (typeof r.source === "string") ctx.addIssue({ code: "custom", path: ["source"], message: "A sidekick's source is an import" });
    }
    if (r.type === "scope") need(["scope", "sidekick", "on"]);
  });
export type SidekickRecord = z.output<typeof sidekickRecordSchema>;

/** The reserved collection (spec §6.4): app-wide, keyed by `id`, never seen by the task agent. Not in `dataCollections` (D0). */
export function sidekickCollection(): Collection {
  return collectionSchema.parse({ scoped: false, key: "id", schema: sidekickRecordSchema, agent: "none" });
}

/** Every setting's value: the stored one, else its default (the manifest's `default` for `on`). */
export interface SidekickSettings {
  on: boolean;
  preSend: boolean;
  afterReply: boolean;
  headsUps: boolean;
  wait: SidekickWait;
  cap: SidekickCap;
  introSeen: boolean;
  presetsOffered: boolean;
  /** Muted kinds per sidekick id (untrusted keys: look up with Object.hasOwn). */
  muted: Record<string, string[]>;
  /** When learning last ran (spec §6.4); absent until it ran. Carried so a toggle never drops it. */
  learnedAt?: string;
  /** The local day the daily card last ran (YYYY-MM-DD); absent until it ran. */
  lastDaily?: string;
}

export function sidekickSettings(stored: Partial<SidekickRecord> | null, m: Pick<SidekickManifest, "default"> | undefined): SidekickSettings {
  return {
    on: stored?.on ?? m?.default === "on",
    preSend: stored?.preSend ?? true,
    afterReply: stored?.afterReply ?? true,
    headsUps: stored?.headsUps ?? true,
    wait: stored?.wait ?? 6,
    cap: stored?.cap ?? 20_000,
    introSeen: stored?.introSeen ?? false,
    presetsOffered: stored?.presetsOffered ?? false,
    muted: stored?.muted ?? {},
    ...(stored?.learnedAt !== undefined ? { learnedAt: stored.learnedAt } : {}),
    ...(stored?.lastDaily !== undefined ? { lastDaily: stored.lastDaily } : {}),
  };
}

/** A sidekick as the controller uses it: a `sidekick` record without its type. */
export interface SidekickDef {
  id: string;
  name: string;
  mark: string;
  personality: string;
  purposes: SidekickPurposeDef[];
  order: number;
  tier?: "light" | "standard" | "deep";
  source?: { kind: "paste" } | { kind: "files"; paths: string[]; hash: string };
  preset?: string;
  /** On in a scope with no scope record (spec §2a.1, §2a.4); absent = true. */
  defaultOn?: boolean;
}

/** Without sidekick records, a profile gets this one (spec §3): part 1's single Sidekick. `"spark"` names the core's SVG mark. */
export const DEFAULT_SIDEKICK: SidekickDef = { id: "sidekick", name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" }, { id: "focus" }], order: 0 };

/** Whether `s` has a purpose that speaks at `moment`. */
export const speaksAt = (s: Pick<SidekickDef, "purposes">, moment: SidekickMoment): boolean => s.purposes.some((p) => purposeMoments(p).includes(moment));
