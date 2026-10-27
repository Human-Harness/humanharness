import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type Block, blockToolName } from "./block";
import { CORE_BLOCKS, INPUT_CORE_BLOCKS, MODE_CORE_BLOCKS, PHASE_CORE_BLOCKS, RESERVED_BLOCK_NAMES } from "./core-blocks";
import { dataSchema } from "./data";
import { DOCUMENT_KIND_ID } from "./documents";
import { CORE_SHEET_SECTIONS, MATERIAL_STAGE_KEYS, materialSchema } from "./material";
import { DEFAULT_MODE_WORDS, MODE_ID } from "./modes";
import { PHASE_ID, TIME_BOX_MAX } from "./phases";
import { PROFILE_COLLECTION, profileFormSpec, profilesSchema } from "./profiles";
import { SETTING_NAME, checkSettingFields, settingFieldSchema, settingsSchema } from "./settings";
import { type HarnessSetupStep, setupFormSpec, setupStepsSchema } from "./setup";

export * from "./block";
export * from "./core-blocks";
export * from "./data";
export * from "./input";
export * from "./answer";
export * from "./settings";
export * from "./modes";
export * from "./phases";
export * from "./setup";
export * from "./profiles";
export * from "./material";
export * from "./documents";
/** The zod a manifest builds its block schemas with: the same instance the SDK validates them against. */
export { z } from "zod";

/** A harness id: lowercase letters, digits and dashes, starting with a letter. It names the app's data folder. */
export const HARNESS_ID = /^[a-z][a-z0-9-]*$/;

export * from "./language";

/** Every text in a manifest is one English string; the app translates the screens (spec 5 D1). */
const text = z.string().min(1);
export const ACTION_COSTS = ["light", "medium", "heavy"] as const;
export type ActionCost = (typeof ACTION_COSTS)[number];
/**
 * How much model a task needs (resources spec §3 D1). The core maps each tier to a model, an effort and
 * a context cap per engine; a harness never names a model. `custom` is a user setting, never a manifest value.
 */
export const TIERS = ["light", "standard", "deep"] as const;
export type Tier = (typeof TIERS)[number];
/** `a` is a lower tier than `b` (task-modes spec §5.3: a mode's `minTier` against the task's). */
export const tierBelow = (a: Tier, b: Tier): boolean => TIERS.indexOf(a) < TIERS.indexOf(b);
/** Where an action runs in a harness with scopes: inside the open scope, or app-wide (spec §3.3). */
export const SCOPE_MODES = ["required", "none"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];
/** A part of a task (task-phases spec §3): its brief runs as one turn of the same session when the task enters it. */
const phaseSchema = z.object({
  id: z.string().regex(PHASE_ID),
  label: text.max(80),
  /** A file in the harness folder, filled like an action's prompt plus {{phase}}, {{previousPhase}}, {{timeLeft}}. Absent: no turn. */
  brief: z.string().min(1).optional(),
  /** The agent may move on to the next phase on its own; without it, its request waits for the person. */
  auto: z.boolean().optional(),
  /** The modes allowed here (modes spec §7): "any" (the default), "none" or a list of the action's modes. */
  modes: z.union([z.enum(["any", "none"]), z.array(z.string().regex(MODE_ID)).min(1)]).optional(),
  /** The last phase only: its end is the core closing turn (D5). */
  close: z.literal(true).optional(),
});
export type HarnessPhase = z.output<typeof phaseSchema>;
/** A time box the person may choose at the start (spec §5). */
const timeBoxSchema = z.object({
  /** Lengths in whole minutes. */
  options: z.array(z.number().int().min(1).max(TIME_BOX_MAX)).min(1).max(6),
  /** One of the options, or null for no limit. */
  default: z.number().int().nullable().default(null),
  /** The share of the time at which the wrap-up starts; absent: when the time is up. */
  wrapUpAt: z.number().gt(0).max(1).optional(),
});
export type HarnessTimeBox = z.output<typeof timeBoxSchema>;
/**
 * A task the harness can start (a topic card, a step of the guided path, a button): its brief is the first
 * message of the task's engine session. `cost` is how much of the plan it tends to use.
 */
const actionSchema = z.object({
  label: text,
  /** One line under the label on the topic card. */
  description: text.optional(),
  /** The task brief: a file in the harness folder. It may use {{language}} and {{notesIndex}}. */
  prompt: z.string().min(1),
  cost: z.enum(ACTION_COSTS),
  /** The tier the task runs at; absent means "standard". */
  tier: z.enum(TIERS).optional(),
  /** Harnesses with `scopes` only: "required" (default) runs in the open scope, "none" app-wide (`_app`). */
  scope: z.enum(SCOPE_MODES).optional(),
  /** The modes a task of this action may work in (task-modes spec §3); absent: none (D0). */
  modes: z.array(z.string().regex(MODE_ID)).min(1).optional(),
  /** How its task starts: one of `modes`, "recommend" (the default) or "ask". Only with `modes`. */
  defaultMode: z.string().min(1).optional(),
  /** Ordered parts inside one task and one session (task-phases spec D1); absent: none (D0). */
  phases: z.array(phaseSchema).min(1).max(12).optional(),
  /** Lengths the person may choose for the task (spec D6); absent: no time box. */
  timeBox: timeBoxSchema.optional(),
});
/** A folder the agent may read but never change. */
const referenceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: text,
  /** "app-source" (the repository the app runs from, in development), an absolute path or a "~/" path. */
  default: z
    .string()
    .min(1)
    .refine((d) => d === "app-source" || d.startsWith("/") || d.startsWith("~/"), {
      message: 'Use "app-source", an absolute path or a path starting with ~/',
    }),
});
export type HarnessAction = z.output<typeof actionSchema>;
/** A way the AI works inside a task (task-modes spec §3). The person picks it; the agent may recommend it. */
const modeSchema = z.object({
  label: text.max(80),
  /** One line in the list of modes ("See all modes"). */
  description: text.max(300).optional(),
  /** The mode's brief: a file in the harness folder, filled like an action's prompt ({{language}}). */
  brief: z.string().min(1),
  /** The minimum tier the mode works well at; absent: any. */
  minTier: z.enum(TIERS).optional(),
  /** What the agent reads to recommend this mode; never shown to the person. */
  recommend: text.max(400).optional(),
  /** The person's knobs for this mode (harness-settings spec §6), drawn in the harness's Settings tab. */
  settings: z.record(z.string().regex(SETTING_NAME), settingFieldSchema).optional(),
});
export type HarnessMode = z.output<typeof modeSchema>;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const blockSchema = z.custom<Block>(
  (b) => {
    if (typeof b !== "object" || b === null) return false;
    const x = b as Partial<Block>;
    return (
      typeof x.description === "string" &&
      typeof x.visible === "boolean" &&
      (x.tool === undefined || (typeof x.tool === "string" && TOOL_NAME.test(x.tool))) &&
      x.schema instanceof z.ZodObject &&
      x.schema.safeParse(x.example).success &&
      (x.input === undefined || x.input instanceof z.ZodObject) &&
      (x.saveTo === undefined ||
        (typeof x.saveTo === "object" &&
          x.saveTo !== null &&
          typeof x.saveTo.collection === "string" &&
          (x.saveTo.records === undefined || typeof x.saveTo.records === "function")))
    );
  },
  { message: "Expected a block created with defineBlock()" },
);

/** The core's MCP servers (packages/blocks): a harness's own servers can't take these names. */
const RESERVED_MCP_NAMES = ["ui", "data"];

/** One kind of document the harness's agent writes (document-reader spec §4.2). */
/** One line of kind text: a line break would turn the rest into live Markdown in `AGENTS.md`. */
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\r\n]*$/, "Use one line, without line breaks");
const documentKindSchema = z.object({
  when: oneLine(300),
  sections: z.array(oneLine(120)).min(1).max(20),
  status: z.array(oneLine(40)).min(1).max(10).optional(),
});
/** At most this many kinds: each one adds its template to the agent's `AGENTS.md`. */
const MAX_DOCUMENT_KINDS = 20;
/** Document kinds with a template of required `##` sections. Absent: only the base writing guide (D0). */
const documentsSchema = z.object({
  kinds: z
    .record(
      z.string().max(64, "A kind id has at most 64 characters").regex(DOCUMENT_KIND_ID, "A kind id is lowercase letters, digits and -"),
      documentKindSchema,
    )
    .refine((k) => Object.keys(k).length <= MAX_DOCUMENT_KINDS, { message: `At most ${MAX_DOCUMENT_KINDS} document kinds` }),
});

const manifestSchema = z.object({
  id: z.string().regex(HARNESS_ID),
  name: text,
  core: z.string().min(1),
  engines: z.array(z.string().min(1)).min(1),
  folder: z.object({ suggested: z.string().min(1), seed: z.string().optional(), references: z.array(referenceSchema).default([]) }),
  instructions: z.string().min(1),
  permissions: z.object({ edit: z.enum(["folder", "none"]), exec: z.boolean(), web: z.boolean() }),
  blocks: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), blockSchema),
  /** Ids are at most 64 characters: the models config keys a task's setting by its action id. */
  actions: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), actionSchema).default({}),
  /** Optional guided order of action ids (the "Recorrido"). */
  path: z.array(z.string()).min(1).optional(),
  /** Free questions (q-<slug> tasks): the tier they run at; absent means "standard". */
  questions: z.object({ tier: z.enum(TIERS).optional() }).optional(),
  /** The harness's unit of work (a topic, a project): what the app calls it. Absent: one implicit scope (spec D2). */
  scopes: z.object({ label: text, plural: text }).optional(),
  /** Structured records the harness keeps (spec §4): collections by name. */
  data: dataSchema,
  /** Knobs the person sets in a Settings tab of the harness's own (harness-settings spec). Absent: no tab (D0). */
  settings: settingsSchema.optional(),
  /** Ways the AI works inside a task, by id (task-modes spec). Absent: none, and nothing changes (D0). */
  modes: z.record(z.string().regex(MODE_ID), modeSchema).default({}),
  /** The harness's own steps on the setup screen, after the engine (setup-steps spec). Absent: none (D0). */
  setup: setupStepsSchema.optional(),
  /** Several people on one install, each with a folder of their own (profiles spec). Absent: one implicit profile (D4). */
  profiles: profilesSchema.optional(),
  /** The person's own files, cut into small fragments the agent fetches on demand (material spec). Absent: none (D0). */
  material: materialSchema.optional(),
  /** Kinds of documents with section templates; the reader checks them and only warns (document-reader spec §4). Absent: none (D0). */
  documents: documentsSchema.optional(),
  /** One line under the name on the home screen. */
  tagline: text.optional(),
  /** How translations of this harness's screens should sound, in English ("warm and informal, short sentences"). */
  tone: z.string().min(1).max(300).optional(),
  /** Logo file in the harness folder (SVG, PNG or JPEG); defaults to the Human Harness H. */
  logo: z.string().optional(),
  mcp: z.array(z.string()).default([]),
  ui: z.string().optional(),
  locales: z.string().optional(),
  author: z.string().min(1),
  repo: z.url().optional(),
  donate: z.url().optional(),
}).superRefine((m, ctx) => {
  for (const name of Object.keys(m.blocks)) {
    if (RESERVED_BLOCK_NAMES.includes(name)) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `"${name}" is a core block name` });
  }
  // Every block becomes an MCP tool: two blocks (core ones included) cannot share a tool name.
  const tools = new Map<string, string>(
    Object.entries({ ...CORE_BLOCKS, ...INPUT_CORE_BLOCKS, ...MODE_CORE_BLOCKS, ...PHASE_CORE_BLOCKS }).map(([name, b]) => [blockToolName(name, b), name]),
  );
  for (const [name, b] of Object.entries(m.blocks)) {
    const tool = blockToolName(name, b);
    const other = tools.get(tool);
    if (other !== undefined) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `Tool "${tool}" is already used by block "${other}"` });
    else tools.set(tool, name);
  }
  // The harness's own MCP servers are named after its id, next to the core's `ui` and `data` servers.
  if (m.mcp.length > 0 && RESERVED_MCP_NAMES.includes(m.id)) {
    ctx.addIssue({ code: "custom", path: ["id"], message: `"${m.id}" is a built-in MCP server name and the harness's MCP servers are named after its id: use another id` });
  }
  // Free questions' model setting lives under the "questions" key, next to the action ids.
  if (Object.hasOwn(m.actions, "questions")) {
    ctx.addIssue({ code: "custom", path: ["actions", "questions"], message: '"questions" is reserved for free questions: use another action id' });
  }
  for (const [id, a] of Object.entries(m.actions)) {
    if (a.scope !== undefined && !m.scopes) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "scope"], message: "Only a harness that declares scopes can set where an action runs" });
    }
  }
  const seen = new Set<string>();
  for (const id of m.path ?? []) {
    if (!Object.hasOwn(m.actions, id)) ctx.addIssue({ code: "custom", path: ["path"], message: `Unknown action in path: "${id}"` });
    if (m.actions[id]?.scope === "none") ctx.addIssue({ code: "custom", path: ["path"], message: `"${id}" runs outside any scope: it can't be in the path` });
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["path"], message: `"${id}" is in the path twice` });
    seen.add(id);
  }
  const refs = new Set<string>();
  for (const r of m.folder.references) {
    if (refs.has(r.id)) ctx.addIssue({ code: "custom", path: ["folder", "references"], message: `Reference "${r.id}" is declared twice` });
    refs.add(r.id);
  }
  // An answer kept in data goes to a collection the harness declares (input-blocks spec §6).
  for (const [name, b] of Object.entries(m.blocks)) {
    if (b.saveTo && !Object.hasOwn(m.data, b.saveTo.collection)) {
      ctx.addIssue({ code: "custom", path: ["blocks", name, "saveTo"], message: `Collection "${b.saveTo.collection}" is not declared in data` });
    }
  }
  // Modes (task-modes spec §3).
  for (const [id, mode] of Object.entries(m.modes)) {
    if (DEFAULT_MODE_WORDS.includes(id)) ctx.addIssue({ code: "custom", path: ["modes", id], message: `"${id}" is a defaultMode word: use another mode id` });
    if (mode.settings === undefined) continue;
    if (!m.settings) {
      ctx.addIssue({ code: "custom", path: ["modes", id, "settings"], message: "Mode settings are drawn in the harness's Settings tab: declare settings with its tab" });
    }
    checkSettingFields(mode.settings, null, (path, message) => ctx.addIssue({ code: "custom", path: ["modes", id, "settings", ...path], message }));
  }
  for (const [id, a] of Object.entries(m.actions)) {
    if (a.defaultMode !== undefined && !a.modes) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "defaultMode"], message: "Only an action with modes has a defaultMode" });
    }
    if (!a.modes) continue;
    const listed = new Set<string>();
    for (const mode of a.modes) {
      if (!Object.hasOwn(m.modes, mode)) ctx.addIssue({ code: "custom", path: ["actions", id, "modes"], message: `Unknown mode "${mode}"` });
      if (listed.has(mode)) ctx.addIssue({ code: "custom", path: ["actions", id, "modes"], message: `"${mode}" is listed twice` });
      listed.add(mode);
    }
    if (a.defaultMode !== undefined && !DEFAULT_MODE_WORDS.includes(a.defaultMode) && !listed.has(a.defaultMode)) {
      ctx.addIssue({
        code: "custom",
        path: ["actions", id, "defaultMode"],
        message: `"${a.defaultMode}" is not one of this action's modes: use one of them, "recommend" or "ask"`,
      });
    }
  }
  // Phases and the time box (task-phases spec §3).
  for (const [id, a] of Object.entries(m.actions)) {
    const phases = a.phases ?? [];
    const ids = new Set<string>();
    phases.forEach((p, i) => {
      const at = ["actions", id, "phases", i];
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: [...at, "id"], message: `Phase "${p.id}" is declared twice` });
      ids.add(p.id);
      if (p.close && i !== phases.length - 1) ctx.addIssue({ code: "custom", path: [...at, "close"], message: "Only the last phase can be the close phase" });
      if (!Array.isArray(p.modes)) return;
      if (!a.modes) {
        ctx.addIssue({ code: "custom", path: [...at, "modes"], message: "Only an action with modes can list the modes a phase allows" });
        return;
      }
      for (const mode of p.modes) {
        if (!a.modes.includes(mode)) ctx.addIssue({ code: "custom", path: [...at, "modes"], message: `"${mode}" is not one of this action's modes` });
      }
    });
    if (!a.timeBox) continue;
    const options = a.timeBox.options;
    if (new Set(options).size !== options.length) ctx.addIssue({ code: "custom", path: ["actions", id, "timeBox", "options"], message: "Each length is offered once" });
    if (a.timeBox.default !== null && !options.includes(a.timeBox.default)) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "timeBox", "default"], message: "The default is one of the options, or null" });
    }
  }
  // A Settings tab needs something to draw: its own fields or a mode's (harness-settings spec §3, §6).
  const modeSettings = Object.values(m.modes).some((mode) => Object.keys(mode.settings ?? {}).length > 0);
  if (m.settings && Object.keys(m.settings.fields).length === 0 && !modeSettings) {
    ctx.addIssue({ code: "custom", path: ["settings", "fields"], message: "Declare at least one setting" });
  }
  // Setup steps (setup-steps spec §3).
  const stepIds = new Set<string>();
  const interviewed = new Map<string, string>();
  (m.setup ?? []).forEach((s: HarnessSetupStep, i) => {
    const issue = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: ["setup", i, ...p], message });
    if (stepIds.has(s.id)) issue(["id"], `Step "${s.id}" is declared twice`);
    stepIds.add(s.id);
    /** A collection a step keeps its one app-wide record in; undefined (and an issue) when it can't. */
    const oneRecord = (name: string, field: string) => {
      if (!Object.hasOwn(m.data, name)) return void issue([field], `Collection "${name}" is not declared in data`);
      const c = m.data[name];
      if (!c.single || c.scoped) return void issue([field], `A setup step keeps one app-wide record: "${name}" needs single: true and scoped: false`);
      return c;
    };
    if (s.kind === "form") {
      const fromData = s.collection !== undefined || s.fields !== undefined;
      if (fromData === (s.settings !== undefined)) return issue([], "A form takes its fields from a collection (collection and fields) or from the settings (settings), not both");
      for (const key of ["fields", "settings"] as const) {
        const seen = new Set<string>();
        for (const name of s[key] ?? []) {
          if (seen.has(name)) issue([key], `"${name}" is listed twice`);
          seen.add(name);
        }
      }
      if (s.settings) {
        if (!m.settings) return issue(["settings"], "Only a harness with settings can ask for them in a form");
        for (const name of s.settings) if (!Object.hasOwn(m.settings.fields, name)) issue(["settings"], `"${name}" is not a setting`);
        return;
      }
      if (s.collection === undefined || s.fields === undefined) return issue([], "A form over a collection names the collection and its fields");
      const c = oneRecord(s.collection, "collection");
      if (!c) return;
      for (const f of s.fields) if (!Object.hasOwn(c.schema.shape, f)) issue(["fields"], `"${f}" is not a field of "${s.collection}"`);
      for (const f of setupFormSpec(s, m).fields) if (f.kind === null) issue(["fields"], `The setup form can't draw "${f.name}"`);
      return;
    }
    if (s.kind === "interview") {
      if (!Object.hasOwn(m.actions, s.action)) issue(["action"], `Unknown action "${s.action}"`);
      else {
        const a = m.actions[s.action];
        if ((m.path ?? []).includes(s.action)) issue(["action"], `"${s.action}" runs as a setup step: it can't be in the path`);
        if (a.tier === "deep") issue(["action"], "An interview runs at tier light or standard");
        if (m.scopes && a.scope !== "none") issue(["action"], `An interview runs app-wide: set scope: "none" on "${s.action}"`);
        const other = interviewed.get(s.action);
        if (other !== undefined) issue(["action"], `"${s.action}" already runs the interview "${other}"`);
        else interviewed.set(s.action, s.id);
      }
      const c = oneRecord(s.writes, "writes");
      if (c && c.agent !== "write") issue(["writes"], `The agent writes "${s.writes}" during the interview: give it agent: "write"`);
      return;
    }
    if (s.writes !== undefined && !Object.hasOwn(m.data, s.writes)) issue(["writes"], `Collection "${s.writes}" is not declared in data`);
  });
  // Profiles (profiles spec §3).
  if (m.profiles) {
    const issue = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: p, message });
    if (!Object.hasOwn(m.data, PROFILE_COLLECTION)) {
      issue(["profiles"], `Profiles keep who each person is in a "${PROFILE_COLLECTION}" collection: declare it in data`);
    } else {
      const c = m.data[PROFILE_COLLECTION];
      if (!c.single || c.scoped) issue(["data", PROFILE_COLLECTION], `A profile keeps one app-wide record: "${PROFILE_COLLECTION}" needs single: true and scoped: false`);
      const shape = c.schema.shape as Record<string, z.ZodType>;
      // The title: a plain string, never optional (z.string() with or without bounds).
      if (!Object.hasOwn(shape, "name") || !(shape.name instanceof z.ZodString)) {
        issue(["data", PROFILE_COLLECTION], 'The profile collection needs a "name" field that is a string');
      }
      if (m.profiles.fields[0] !== "name") issue(["profiles", "fields"], 'The first field is "name"');
      const seen = new Set<string>();
      for (const f of m.profiles.fields) {
        if (seen.has(f)) issue(["profiles", "fields"], `"${f}" is listed twice`);
        seen.add(f);
        if (!Object.hasOwn(shape, f)) issue(["profiles", "fields"], `"${f}" is not a field of "${PROFILE_COLLECTION}"`);
      }
      for (const f of profileFormSpec(m).fields) if (f.kind === null) issue(["profiles", "fields"], `The profile form can't draw "${f.name}"`);
    }
  }
  // Material (material spec §8).
  if (m.material) {
    const issue = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: ["material", ...p], message });
    const once = (list: readonly string[], key: string) => {
      const seen = new Set<string>();
      for (const v of list) {
        if (seen.has(v)) issue([key], `"${v}" is listed twice`);
        seen.add(v);
      }
    };
    once(m.material.accepts, "accepts");
    once(m.material.fragmentKinds, "fragmentKinds");
    const sections = new Set<string>();
    for (const s of m.material.sheet.sections) {
      if (Object.hasOwn(CORE_SHEET_SECTIONS, s.id)) issue(["sheet", "sections"], `"${s.id}" is a core sheet section`);
      else if (sections.has(s.id)) issue(["sheet", "sections"], `Section "${s.id}" is declared twice`);
      sections.add(s.id);
    }
    const items = m.material.items;
    if (items) {
      if (!Object.hasOwn(m.data, items.collection)) issue(["items", "collection"], `Collection "${items.collection}" is not declared in data`);
      else {
        const c = m.data[items.collection];
        if (c.single || c.key === undefined) issue(["items", "collection"], `Fragments link to records by key: "${items.collection}" needs a key, not single: true`);
        if (!Object.hasOwn(c.schema.shape, items.label)) issue(["items", "label"], `"${items.label}" is not a field of "${items.collection}"`);
        // Linking sends the items to the engine's provider: a collection hidden from the agent can't be linked to.
        if (c.agent === "none") issue(["items", "collection"], `"${items.collection}" is hidden from the agent (agent: "none"): fragments can't link to it`);
      }
    }
    // Settings › Models keys each stage's setting next to the action ids.
    for (const key of MATERIAL_STAGE_KEYS) {
      if (Object.hasOwn(m.actions, key)) ctx.addIssue({ code: "custom", path: ["actions", key], message: `"${key}" is reserved for a material stage: use another action id` });
    }
  }
  // Document kinds (document-reader spec §4.2): a section named twice could never be told apart by the check.
  for (const [id, kind] of Object.entries(m.documents?.kinds ?? {})) {
    const seen = new Set<string>();
    kind.sections.forEach((s, i) => {
      const key = s.trim().toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["documents", "kinds", id, "sections", i], message: `"${s}" is listed twice` });
      seen.add(key);
    });
    const statuses = new Set<string>();
    kind.status?.forEach((s, i) => {
      const key = s.toLowerCase();
      if (statuses.has(key)) ctx.addIssue({ code: "custom", path: ["documents", "kinds", id, "status", i], message: `"${s}" is listed twice` });
      statuses.add(key);
    });
  }
});

export type Harness = z.output<typeof manifestSchema>;
export type HarnessInput = z.input<typeof manifestSchema>;
export type Permissions = Harness["permissions"];
export type HarnessReference = Harness["folder"]["references"][number];

export function defineHarness(config: HarnessInput): Harness {
  return manifestSchema.parse(config);
}

/** Where `action` runs: null when the harness has no scopes, else its `scope` ("required" when not set). */
export function actionScope(harness: Pick<Harness, "scopes" | "actions">, action: string): ScopeMode | null {
  if (!harness.scopes) return null;
  return harness.actions[action]?.scope ?? "required";
}

export interface LoadedHarness extends Harness {
  /** Absolute folder that contains the manifest. */
  root: string;
  /** Absolute path of the manifest file. */
  configPath: string;
}

export async function loadHarness(configPath: string, options: { root?: string } = {}): Promise<LoadedHarness> {
  const absolute = path.resolve(configPath);
  const mod = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  if (mod.default === undefined) throw new Error(`${absolute} has no default export`);
  const harness = manifestSchema.parse(mod.default);
  const loaded: LoadedHarness = { ...harness, root: options.root ? path.resolve(options.root) : path.dirname(absolute), configPath: absolute };
  // Every task brief must live inside the harness folder.
  for (const action of Object.values(loaded.actions)) resolveInHarness(loaded, action.prompt);
  // So must every mode's brief (task-modes spec §3).
  for (const mode of Object.values(loaded.modes)) resolveInHarness(loaded, mode.brief);
  // And every phase's brief (task-phases spec §3).
  for (const action of Object.values(loaded.actions)) for (const p of action.phases ?? []) if (p.brief) resolveInHarness(loaded, p.brief);
  return loaded;
}

export function resolveInHarness(harness: LoadedHarness, relative: string): string {
  const resolved = path.resolve(harness.root, relative);
  const rel = path.relative(harness.root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the harness folder: ${relative}`);
  }
  return resolved;
}
