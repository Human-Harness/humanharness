import { promises as fs } from "node:fs";
import path from "node:path";
import { type Recording, choiceLabels, recordingSchema } from "@humanharness/fake-agent";
import { ENGINES, type Mode, brandNames } from "@humanharness/engines";
import {
  type InputFieldUi,
  type LoadedHarness,
  SETTINGS_TOKENS_WARN,
  SIDEKICK_TIPS_TOKENS_WARN,
  blockToolName,
  hasTools,
  inputBlocks,
  inputFields,
  isStringArray,
  loadHarness,
  parseAnswer,
  resolveInHarness,
  settingsSentences,
  settingsValues,
  type z,
} from "@humanharness/harness-sdk";
import { estimateTokens, settingsLines, writingLines } from "@humanharness/workspace";
import { type Io, UsageError, parseCommand } from "./cli";
import { type HarnessDoc, PERMISSION_KEYS, type PermissionKey, QUESTIONS_ROW, parseHarnessMd, sectionText } from "./harness-md";
import { clashMessage, matchClashes } from "./mock-match";
import { HARNESS_MD, MANIFEST } from "./paths";
import { ToolBuildError, buildTools } from "./tool-build";

export type Severity = "error" | "warning";
export type RuleId =
  | "schema"
  | "i18n"
  | "brief-missing"
  | "brand"
  | "engine-not-allowed"
  | "harness-md-missing"
  | "harness-md-mismatch"
  | "pillar-decisions"
  | "pillar-flow"
  | "pillar-context"
  | "tier-cost"
  | "permissions-wide"
  | "open-questions"
  | "mock-schema"
  | "mock-action"
  | "mock-match"
  | "mock-next"
  | "mock-choice"
  | "input-hidden"
  | "input-form"
  | "input-choice"
  | "mock-input"
  | "settings-tokens"
  | "documents-tokens"
  | "setup-component"
  | "setup-mock"
  | "setup-context"
  | "material-review-tier"
  | "material-items-scope"
  | "sidekick-tips"
  | "job-daily-tokens"
  | "tool-build";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** Relative to the harness folder. */
  file: string;
  line?: number;
}

export interface CheckResult {
  findings: Finding[];
  /** The loaded manifest; null when it failed the schema. */
  harness: LoadedHarness | null;
}

const finding =
  (severity: Severity) =>
  (rule: RuleId, message: string, file: string, line?: number): Finding => ({ rule, severity, message, file, ...(line ? { line } : {}) });
const error = finding("error");
const warning = finding("warning");

const read = (file: string) => fs.readFile(file, "utf8").catch(() => null);
const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** Validates the harness in `dir` (spec §7). Errors make the CLI exit with 1. */
export async function checkHarness(dir: string, opts: { mode?: Mode } = {}): Promise<CheckResult> {
  const root = path.resolve(dir);
  const findings: Finding[] = [];
  const harness = await loadManifest(root, findings);
  const mdText = await read(path.join(root, HARNESS_MD));
  const doc = mdText === null ? null : parseHarnessMd(mdText);
  if (!doc) findings.push(error("harness-md-missing", "HARNESS.md is missing: create it with `humanharness init` or the /new-harness guide.", HARNESS_MD));
  else if (!doc.flow) findings.push(error("harness-md-missing", "HARNESS.md has no Flow table (| Action | Tier | Cost | Purpose |) under ## Flow.", HARNESS_MD, doc.sections.get("Flow")?.line));
  if (!harness) return { findings, harness: null };

  const briefs = await readBriefs(harness);
  findings.push(...briefFindings(harness, briefs));
  findings.push(...(await modeFindings(harness)));
  findings.push(...(await phaseFindings(harness)));
  findings.push(...(await jobFindings(harness)));
  findings.push(...(await toolBuildFindings(root, harness)));
  findings.push(...(await mockFindings(harness, briefs)));
  findings.push(...(await i18nFindings(harness)));
  findings.push(...(await inputFindings(harness)));
  findings.push(...settingsFindings(harness));
  findings.push(...sidekickFindings(harness));
  findings.push(...documentKindsFindings(harness));
  findings.push(...(await setupFindings(harness)));
  findings.push(...brandFindings(harness));
  findings.push(...engineFindings(harness, opts.mode ?? "development"));
  if (doc) findings.push(...malformedPermissionFindings(doc));
  if (doc?.flow) findings.push(...mismatchFindings(harness, doc));
  const instructions = await readInstructions(harness, findings);
  findings.push(...pillarFindings(harness, briefs, instructions, doc));
  findings.push(...tierCostFindings(harness));
  findings.push(...materialFindings(harness));
  findings.push(...permissionFindings(harness, doc));
  findings.push(...openQuestionFindings(doc));
  return { findings, harness };
}

async function loadManifest(root: string, findings: Finding[]): Promise<LoadedHarness | null> {
  const file = path.join(root, MANIFEST);
  if (!(await exists(file))) {
    findings.push(error("schema", "harness.config.ts is missing.", MANIFEST));
    return null;
  }
  try {
    return await loadHarness(file);
  } catch (err) {
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (Array.isArray(issues)) {
      for (const issue of issues) findings.push(error("schema", `${issue.path.map(String).join(".") || "(manifest)"}: ${issue.message}`, MANIFEST));
    } else findings.push(error("schema", err instanceof Error ? err.message : String(err), MANIFEST));
    return null;
  }
}

/** A manifest path inside the harness folder; null (and a schema error) when it escapes it. */
function resolveField(h: LoadedHarness, field: string, relative: string, findings: Finding[]): string | null {
  try {
    return resolveInHarness(h, relative);
  } catch {
    findings.push(error("schema", `${field}: "${relative}": path escapes the harness folder.`, MANIFEST));
    return null;
  }
}

/** The harness's instructions; "" when they are missing (an error) or out of the folder (a schema error). */
async function readInstructions(h: LoadedHarness, findings: Finding[]): Promise<string> {
  const file = resolveField(h, "instructions", h.instructions, findings);
  if (file === null) return "";
  const text = await read(file);
  if (text === null) findings.push(error("brief-missing", `The instructions file ${h.instructions} does not exist.`, MANIFEST));
  return text ?? "";
}

/** Each action's brief text; null when it can't be read. */
async function readBriefs(h: LoadedHarness): Promise<Map<string, string | null>> {
  const briefs = new Map<string, string | null>();
  for (const [id, action] of Object.entries(h.actions)) briefs.set(id, await read(resolveInHarness(h, action.prompt)));
  return briefs;
}

const MOCK_DIR = "mock";

/** `mock/*.json` (spec 3e §3): each file a valid recording of an action, whose branches lead somewhere real. */
async function mockFindings(h: LoadedHarness, briefs: Map<string, string | null>): Promise<Finding[]> {
  const dir = path.join(h.root, MOCK_DIR);
  const entries = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
  const findings: Finding[] = [];
  const valid: { rec: Recording; file: string }[] = [];
  for (const entry of entries) {
    const name = entry.name;
    const file = `${MOCK_DIR}/${name}`;
    if (!entry.isFile()) {
      findings.push(error("mock-schema", `${name} is not a file.`, file));
      continue;
    }
    let rec: Recording;
    try {
      const parsed = recordingSchema.safeParse(JSON.parse((await read(path.join(dir, name))) ?? ""));
      if (!parsed.success) {
        for (const i of parsed.error.issues) findings.push(error("mock-schema", `${i.path.join(".") || "(root)"}: ${i.message}`, file));
        continue;
      }
      rec = parsed.data;
    } catch (err) {
      findings.push(error("mock-schema", `Not valid JSON: ${(err as Error).message}`, file));
      continue;
    }
    if (!Object.hasOwn(h.actions, rec.action)) {
      findings.push(error("mock-action", `Action "${rec.action}" is not in the manifest.`, file));
      continue;
    }
    if (name !== `${rec.action}.json`) findings.push(error("mock-action", `The recording of "${rec.action}" must be named ${rec.action}.json.`, file));
    // Placeholders like {{language}} are filled at runtime, so `match` is checked against the brief's raw text.
    const brief = briefs.get(rec.action);
    if (brief && !brief.includes(rec.match)) findings.push(error("mock-match", `"${rec.match}" is not in the brief of "${rec.action}", so the recording would never play.`, file));
    else valid.push({ rec, file });
    const ids = rec.turns.map((t) => t.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) findings.push(error("mock-next", `Turn ids appear more than once: ${[...new Set(dupes)].join(", ")}.`, file));
    for (const turn of rec.turns) {
      const labels = new Set(choiceLabels(turn.blocks));
      for (const [key, target] of Object.entries(turn.next ?? {})) {
        if (!ids.includes(target)) findings.push(error("mock-next", `Turn "${turn.id}": "${key}" leads to "${target}", which is not a turn.`, file));
        if (key !== "*" && !labels.has(key)) findings.push(error("mock-choice", `Turn "${turn.id}": "${key}" is not a choice it offers.`, file));
      }
      // Each recorded answer answers an input block this turn shows, and is one the app would take (spec §8).
      for (const [i, r] of (turn.respond ?? []).entries()) {
        const where = `Turn "${turn.id}": respond[${i}]`;
        if (!ids.includes(r.next)) findings.push(error("mock-next", `${where} leads to "${r.next}", which is not a turn.`, file));
        const block = Object.hasOwn(h.blocks, r.block) ? h.blocks[r.block] : undefined;
        if (!block?.input) {
          findings.push(error("mock-input", `${where} answers "${r.block}", which is not an input block.`, file));
          continue;
        }
        if (!turn.blocks.some((b) => b.tool === blockToolName(r.block, block))) {
          findings.push(error("mock-input", `${where} answers "${r.block}", which this turn doesn't show.`, file));
        }
        const parsed = parseAnswer(block, r.value);
        if (!parsed.ok) {
          findings.push(error("mock-input", `${where} is not a valid answer: ${parsed.errors.map((e) => `${e.path || "(answer)"} ${e.message}`).join("; ")}.`, file));
        }
      }
    }
  }
  // Replay picks the recording with the longest `match` found in a task's first message, so one action's match
  // inside another's brief is only safe when the other action has a longer match of its own in its brief.
  for (const { rec, file } of valid) {
    for (const other of matchClashes(rec.action, rec.match, briefs, (id) => valid.find((v) => v.rec.action === id)?.rec.match)) {
      findings.push(error("mock-match", clashMessage(rec.match, other), file));
    }
  }
  return findings;
}

function briefFindings(h: LoadedHarness, briefs: Map<string, string | null>): Finding[] {
  return Object.entries(h.actions).flatMap(([id, action]) => {
    const text = briefs.get(id);
    if (text === null || text === undefined) return [error("brief-missing", `Action "${id}": its brief ${action.prompt} does not exist.`, MANIFEST)];
    if (!text.trim()) return [error("brief-missing", `Action "${id}": its brief ${action.prompt} is empty.`, path.relative(h.root, resolveInHarness(h, action.prompt)))];
    return [];
  });
}

/** Every mode's brief exists and says something (task-modes spec §3 `check`). No modes: nothing (D0). */
async function modeFindings(h: LoadedHarness): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [id, mode] of Object.entries(h.modes)) {
    const file = resolveInHarness(h, mode.brief);
    const text = await read(file);
    if (text === null) out.push(error("brief-missing", `Mode "${id}": its brief ${mode.brief} does not exist.`, MANIFEST));
    else if (!text.trim()) out.push(error("brief-missing", `Mode "${id}": its brief ${mode.brief} is empty.`, path.relative(h.root, file)));
  }
  return out;
}

/** Every phase brief exists and has text (task-phases spec §3); a phase without a brief changes only the state. */
async function phaseFindings(h: LoadedHarness): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [id, action] of Object.entries(h.actions)) {
    for (const phase of action.phases ?? []) {
      if (!phase.brief) continue;
      const file = resolveInHarness(h, phase.brief);
      const text = await read(file);
      const where = `Action "${id}", phase "${phase.id}": its brief ${phase.brief}`;
      if (text === null) out.push(error("brief-missing", `${where} does not exist.`, MANIFEST));
      else if (!text.trim()) out.push(error("brief-missing", `${where} is empty.`, path.relative(h.root, file)));
    }
  }
  return out;
}

/** Each job's brief (parallel spec §3): it must exist and say something. A `dailyTokens` with no `every` is a warning; the jobs' other checks are schema errors. */
async function jobFindings(h: LoadedHarness): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [id, job] of Object.entries(h.jobs ?? {})) {
    const file = resolveInHarness(h, job.prompt);
    const text = await read(file);
    if (text === null) out.push(error("brief-missing", `Job "${id}": its brief ${job.prompt} does not exist.`, MANIFEST));
    else if (!text.trim()) out.push(error("brief-missing", `Job "${id}": its brief ${job.prompt} is empty.`, path.relative(h.root, file)));
    if (job.dailyTokens !== undefined && job.on.every === undefined) {
      out.push(warning("job-daily-tokens", `Job "${id}": dailyTokens caps only periodic runs and the job has no every, so it caps nothing.`, MANIFEST));
    }
  }
  return out;
}

/** Every key of a locale file, nested keys joined with dots. */
export function flatKeys(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

/** `t("key")` with a literal key: the same quote on both sides, so `t(\`prefix.${x}\`)` is no key. */
const UI_KEY = /\bt\(\s*(["'`])([A-Za-z0-9_.-]+)\1/g;

/** The .ts/.tsx files under `dir`, or `dir` itself when it is one. */
async function sourceFiles(dir: string): Promise<string[]> {
  const stat = await fs.stat(dir).catch(() => null);
  if (stat?.isFile()) return /\.tsx?$/.test(dir) ? [dir] : [];
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

async function i18nFindings(h: LoadedHarness): Promise<Finding[]> {
  const out: Finding[] = [];
  const localesDir = h.locales ?? "locales";
  const localesPath = resolveField(h, "locales", localesDir, out);
  const uiPath = resolveField(h, "ui", h.ui ?? "ui", out);
  if (localesPath === null) return out;
  const uiFiles = uiPath === null ? [] : await sourceFiles(uiPath);
  if (!(await exists(localesPath)) && uiFiles.length === 0) return out;
  let enKeys: Set<string> | null = null;
  const file = path.join(localesDir, "en.json");
  const text = await read(path.join(localesPath, "en.json"));
  if (text === null) {
    out.push(error("i18n", `${file} is missing: the harness's strings are English.`, file));
  } else {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) out.push(error("i18n", `${file} must be a JSON object.`, file));
      else enKeys = new Set(flatKeys(parsed as Record<string, unknown>));
    } catch {
      out.push(error("i18n", `${file} is not valid JSON.`, file));
    }
  }
  // Only en.json is read: the app generates every other language (spec 5 D1).
  const others = (await fs.readdir(localesPath).catch(() => [])).filter((f) => f.endsWith(".json") && f !== "en.json").sort();
  for (const other of others) {
    const rel = path.join(localesDir, other);
    out.push(warning("i18n", `${rel} is not read: the app translates from en.json.`, rel));
  }
  for (const uiFile of uiFiles) {
    const text = await fs.readFile(uiFile, "utf8");
    for (const m of text.matchAll(UI_KEY)) {
      const line = text.slice(0, m.index).split("\n").length;
      if (enKeys && !enKeys.has(m[2])) out.push(error("i18n", `"${m[2]}" is used here but missing in en.`, path.relative(h.root, uiFile), line));
    }
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Input blocks (input-blocks spec §8): one the person can't see can't be answered; a field the core form can't draw
 * needs the block's own component; a choice needs a list of options in the shown data. That a component is registered
 * is guessed from the ui/ sources: the block's name used as an object key (`name:`, `name,` or `name }`).
 */
async function inputFindings(h: LoadedHarness): Promise<Finding[]> {
  const inputs = Object.entries(inputBlocks(h.blocks));
  if (inputs.length === 0) return [];
  let uiDir: string | null = null;
  try {
    uiDir = resolveInHarness(h, h.ui ?? "ui");
  } catch {
    // reported by i18nFindings
  }
  const texts = uiDir ? await Promise.all((await sourceFiles(uiDir)).map((f) => fs.readFile(f, "utf8"))) : [];
  const out: Finding[] = [];
  for (const [name, block] of inputs) {
    if (!block.visible) out.push(warning("input-hidden", `Block "${name}" asks for an answer but is not visible: the person can't see it to answer.`, MANIFEST));
    const fields = inputFields(block);
    const drawless = fields.filter((f) => f.kind === null).map((f) => `"${f.name}"`);
    const key = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}\\s*[:,}]`);
    if (drawless.length > 0 && !texts.some((t) => key.test(t))) {
      out.push(warning("input-form", `Block "${name}": the core form can't draw ${drawless.join(", ")}. Register a component for it in ui/ (blocks: { ${name}: … }).`, MANIFEST));
    }
    // A choice whose options can't come from the shown data quietly falls back to a text field.
    const ui = (block.inputUi ?? {}) as Record<string, InputFieldUi | undefined>;
    const shown = block.schema.shape as Record<string, z.ZodType>;
    for (const field of fields) {
      const fieldUi = Object.hasOwn(ui, field.name) ? ui[field.name] : undefined;
      const from = fieldUi?.optionsFrom;
      const kind = fieldUi?.kind;
      const isString = field.kind === "text" || field.kind === "longText" || field.optionsFrom !== undefined;
      if (from !== undefined && field.optionsFrom === from && !(Object.hasOwn(shown, from) && isStringArray(shown[from]))) {
        const message = `Block "${name}": inputUi.${field.name}.optionsFrom is "${from}", which is not a string-list field of the shown data. The form draws "${field.name}" as text.`;
        out.push(warning("input-choice", message, MANIFEST));
      } else if (kind !== undefined && !isString && !(kind === "choice" && field.kind === "choice")) {
        // inputUi.kind only switches a string field; any other field's kind comes from its zod type.
        const message = `Block "${name}": inputUi.${field.name}.kind "${kind}" is ignored: only a z.string() field can be text, longText or a choice, and "${field.name}" is drawn from its type.`;
        out.push(warning("input-choice", message, MANIFEST));
      } else if (kind === "choice" && field.kind !== "choice") {
        const message = `Block "${name}": "${field.name}" is a choice with no options: set inputUi.${field.name}.optionsFrom to a string-list field of the shown data. The form draws it as text.`;
        out.push(warning("input-choice", message, MANIFEST));
      }
    }
  }
  return out;
}

/**
 * Harness settings (harness-settings spec §5 "Measuring"): their section of AGENTS.md is in every session's stable
 * prefix. Measured with every sentence filled with its default, `onlyWhenChanged` ones included. The structural
 * rules (defaults, options, sections, placeholders) are manifest schema errors, reported as `schema`.
 */
function settingsFindings(h: LoadedHarness): Finding[] {
  if (!h.settings) return [];
  const sentences = settingsSentences(h.settings, settingsValues(h.settings, null), { all: true });
  const tokens = estimateTokens(settingsLines(sentences).join("\n"));
  if (tokens <= SETTINGS_TOKENS_WARN) return [];
  const message = `The settings' sentences take about ${tokens} tokens of AGENTS.md (more than ${SETTINGS_TOKENS_WARN}): keep each one short, or mark the ones that only matter when changed with onlyWhenChanged.`;
  return [warning("settings-tokens", message, MANIFEST)];
}

/** Over this, the document kinds' part of AGENTS.md is long for every session's stable prefix. */
const DOCUMENT_KINDS_TOKENS_WARN = 400;

/** Document kinds (document-reader spec §4.2): their part of AGENTS.md is in every session's stable prefix too. */
function documentKindsFindings(h: LoadedHarness): Finding[] {
  const kinds = h.documents?.kinds;
  if (!kinds || Object.keys(kinds).length === 0) return [];
  // What the kinds add on top of the base guide, which every harness has anyway.
  const tokens = estimateTokens(writingLines({ kinds }).join("\n")) - estimateTokens(writingLines({ kinds: {} }).join("\n"));
  if (tokens <= DOCUMENT_KINDS_TOKENS_WARN) return [];
  const message = `The document kinds take about ${tokens} tokens of AGENTS.md (more than ${DOCUMENT_KINDS_TOKENS_WARN}): keep each \`when\` to one short sentence and declare only the kinds the harness needs.`;
  return [warning("documents-tokens", message, MANIFEST)];
}

/**
 * Sidekick's tips (sidekick spec §3): they go in the Sidekick brief, read on every review, so each text stays within
 * SIDEKICK_TIPS_TOKENS_WARN tokens. Unknown action ids and `checks` keys are manifest schema errors, reported as `schema`.
 */
function sidekickFindings(h: LoadedHarness): Finding[] {
  const tips = h.sidekick?.tips;
  if (tips === undefined) return [];
  const texts = typeof tips === "string" ? [["", tips] as const] : Object.entries(tips).map(([purpose, text]) => [` (${purpose})`, text ?? ""] as const);
  return texts.flatMap(([which, text]) => {
    const tokens = estimateTokens(text);
    if (tokens <= SIDEKICK_TIPS_TOKENS_WARN) return [];
    const message = `Sidekick's tips take about ${tokens} tokens (more than ${SIDEKICK_TIPS_TOKENS_WARN})${which}: keep them to the few hints that matter in every review.`;
    return [warning("sidekick-tips", message, MANIFEST)];
  });
}

/**
 * Setup steps (setup-steps spec §6): what the manifest's schema can't see. A component step needs the harness's
 * component in ui/ (guessed like input-form's); an interview needs a recording once the harness has mock recordings
 * (spec §8 Q2), and a collection the agent sees when it runs again.
 */
async function setupFindings(h: LoadedHarness): Promise<Finding[]> {
  if (!h.setup) return [];
  const out: Finding[] = [];
  const components = h.setup.flatMap((s) => (s.kind === "component" ? [s] : []));
  if (components.length > 0) {
    let uiDir: string | null = null;
    try {
      uiDir = resolveInHarness(h, h.ui ?? "ui");
    } catch {
      // reported by i18nFindings
    }
    const texts = uiDir ? await Promise.all((await sourceFiles(uiDir)).map((f) => fs.readFile(f, "utf8"))) : [];
    for (const s of components) {
      const key = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(s.component)}\\s*[:,}]`);
      if (!texts.some((t) => key.test(t))) {
        const message = `Step "${s.id}": no component "${s.component}" in ui/. Pass it to HarnessApp (setupSteps={{ ${s.component} }}); until then the setup screen says the step can't be shown.`;
        out.push(warning("setup-component", message, MANIFEST));
      }
    }
  }
  const recordings = (await fs.readdir(path.join(h.root, MOCK_DIR), { withFileTypes: true }).catch(() => [])).some((e) => e.isFile() && e.name.endsWith(".json"));
  for (const s of h.setup) {
    if (s.kind !== "interview") continue;
    if (recordings && !(await exists(path.join(h.root, MOCK_DIR, `${s.action}.json`)))) {
      out.push(warning("setup-mock", `Step "${s.id}": its action "${s.action}" has no recording (${MOCK_DIR}/${s.action}.json), so mock mode can't play the interview.`, MANIFEST));
    }
    const c = Object.hasOwn(h.data, s.writes) ? h.data[s.writes] : undefined;
    if (c && !c.context) {
      out.push(warning("setup-context", `Step "${s.id}": collection "${s.writes}" has no context, so a second run of the interview can't see what the first one saved. Give it context: { fields: "all", tokens: … }.`, MANIFEST));
    }
  }
  return out;
}

/** The first provider or model brand in `text` (whole words, any case), or null. */
export function findBrand(text: string): string | null {
  for (const brand of brandNames()) {
    if (new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(brand)}(?![A-Za-z0-9])`, "i").test(text)) return brand;
  }
  return null;
}

function brandFindings(h: LoadedHarness): Finding[] {
  // Only the app's identity is checked: briefs and instructions may name engines freely, and a word
  // that merely contains a brand ("Claudette", "codexes") is not one.
  const places: [where: string, field: string, text: string | undefined][] = [
    ["name", "app name", h.name],
    ["tagline", "app tagline", h.tagline],
    ["logo file name", "logo file name", h.logo ? path.basename(h.logo) : undefined],
  ];
  return places.flatMap(([where, field, text]) => {
    const brand = text ? findBrand(text) : null;
    if (!text || !brand) return [];
    const message = `The ${where} "${text}" uses the word "${brand}", a provider or model brand in the ${field}: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.`;
    return [error("brand", message, MANIFEST)];
  });
}

function engineFindings(h: LoadedHarness, mode: Mode): Finding[] {
  return h.engines.flatMap((id) => {
    const engine = ENGINES.find((e) => e.id === id);
    if (!engine) return [error("engine-not-allowed", `Unknown engine "${id}". Known: ${ENGINES.map((e) => e.id).join(", ")}.`, MANIFEST)];
    if (engine.status === "excluded") return [error("engine-not-allowed", `${engine.name} is excluded: its terms don't allow this use (${engine.statusSource}).`, MANIFEST)];
    if (engine.status === "pending" && mode === "distribution") {
      return [error("engine-not-allowed", `${engine.name} is pending legal review: it can only be used in development.`, MANIFEST)];
    }
    return [];
  });
}

function mismatchFindings(h: LoadedHarness, doc: HarnessDoc): Finding[] {
  const out: Finding[] = [];
  const mismatch = (message: string, line?: number) => out.push(error("harness-md-mismatch", message, HARNESS_MD, line));
  const flow = doc.flow ?? [];
  const flowLine = doc.sections.get("Flow")?.line;
  const rows = new Map(flow.filter((r) => r.action !== QUESTIONS_ROW).map((r) => [r.action, r]));
  for (const [id, action] of Object.entries(h.actions)) {
    const row = rows.get(id);
    const tier = action.tier ?? "standard";
    if (!row) mismatch(`Action "${id}" is missing from the Flow table.`, flowLine);
    else if (row.tier !== tier) mismatch(`"${id}": the Flow table says tier ${row.tier}, harness.config.ts says ${tier}.`, row.line);
  }
  for (const row of rows.values()) {
    if (!Object.hasOwn(h.actions, row.action)) mismatch(`The Flow table lists "${row.action}", which harness.config.ts doesn't declare.`, row.line);
  }
  const questions = flow.find((r) => r.action === QUESTIONS_ROW);
  const questionsTier = h.questions?.tier ?? "standard";
  if (!questions) mismatch(`The Flow table has no ${QUESTIONS_ROW} row.`, flowLine);
  else if (questions.tier !== questionsTier) mismatch(`${QUESTIONS_ROW}: the Flow table says tier ${questions.tier}, harness.config.ts says ${questionsTier}.`, questions.line);

  const permsLine = doc.sections.get("Permissions and engines")?.line;
  const manifest: Record<PermissionKey, string> = { edit: h.permissions.edit, exec: String(h.permissions.exec), web: String(h.permissions.web) };
  for (const key of PERMISSION_KEYS) {
    const p = doc.permissions.find((x) => x.key === key);
    if (!p && doc.malformedPermissions.some((x) => x.key === key)) continue; // reported by malformedPermissionFindings
    if (!p) mismatch(`Permissions and engines has no "${key}:" line.`, permsLine);
    else if (p.value !== manifest[key]) mismatch(`${key}: HARNESS.md says ${p.value}, harness.config.ts says ${manifest[key]}.`, p.line);
  }
  if (!doc.engines) mismatch('Permissions and engines has no "engines:" line.', permsLine);
  else if ([...doc.engines.ids].sort().join(",") !== [...h.engines].sort().join(",")) {
    mismatch(`engines: HARNESS.md says ${doc.engines.ids.join(", ")}, harness.config.ts says ${h.engines.join(", ")}.`, doc.engines.line);
  }
  return out;
}

/** A permission line HARNESS.md can't read, with the format it expects. */
function malformedPermissionFindings(doc: HarnessDoc): Finding[] {
  return doc.malformedPermissions
    .filter((m) => !doc.permissions.some((p) => p.key === m.key))
    .map((m) => {
      const example = `- ${m.key}: ${m.key === "edit" ? "none" : "false"} — reason`;
      return error("harness-md-mismatch", `Permissions and engines: "${m.text}" is not in the expected format \`${example}\`.`, HARNESS_MD, m.line);
    });
}

/** A brief that tells the AI not to save its note. */
const SKIP_NOTE = /\b(?:never|don['’]t|do not)\s+(?:call\s+)?`?save_note\b/i;

function pillarFindings(h: LoadedHarness, briefs: Map<string, string | null>, instructions: string, doc: HarnessDoc | null): Finding[] {
  const out: Finding[] = [];
  const texts = [...briefs.values()].filter((t): t is string => typeof t === "string");
  const choices = [instructions, ...texts].some((t) => t.includes("show_choices"));
  if (!choices && Object.keys(h.blocks).length === 0) {
    out.push(warning("pillar-decisions", "No brief or instruction asks for show_choices and the harness has no custom block: the person has nothing to decide with.", MANIFEST));
  }
  if (Object.keys(h.actions).length <= 1 && !h.path && !choices) {
    out.push(warning("pillar-flow", "One action, no path and no choices: this is effectively a chat. Add actions, a path, or choices that lead somewhere.", MANIFEST));
  }
  if (texts.length > 0 && texts.every((t) => SKIP_NOTE.test(t))) {
    out.push(warning("pillar-context", "Every brief tells the AI not to save a note: closed tasks keep nothing.", MANIFEST));
  }
  const context = doc?.sections.get("Context");
  if (doc && !sectionText(context)) out.push(warning("pillar-context", "HARNESS.md → Context is empty: say what each closed task must keep.", HARNESS_MD, context?.line));
  return out;
}

/** Tools (tools spec §3.3): the build runs in memory, nothing written; each tool that fails is one error. None without tools (D0). */
async function toolBuildFindings(root: string, h: LoadedHarness): Promise<Finding[]> {
  if (!hasTools(h)) return [];
  try {
    await buildTools(root, { write: false, harness: h });
    return [];
  } catch (err) {
    if (err instanceof ToolBuildError) return err.problems.map((p) => error("tool-build", p.message, p.file));
    return [error("tool-build", err instanceof Error ? err.message : String(err), MANIFEST)];
  }
}

function tierCostFindings(h: LoadedHarness): Finding[] {
  return Object.entries(h.actions).flatMap(([id, action]) => {
    const tier = action.tier ?? "standard";
    if (action.cost === "heavy" && tier === "light") return [warning("tier-cost", `"${id}" has cost "heavy" but runs at tier light: raise the tier or lower the cost hint.`, MANIFEST)];
    if (action.cost === "light" && tier === "deep") return [warning("tier-cost", `"${id}" has cost "light" but runs at tier deep: lower the tier or raise the cost hint.`, MANIFEST)];
    return [];
  });
}

/** Material (material spec §8): two choices that work but cost quality. None without material (D0). */
function materialFindings(h: LoadedHarness): Finding[] {
  const m = h.material;
  if (!m) return [];
  const out: Finding[] = [];
  if (m.tiers.review === "light")
    out.push(warning("material-review-tier", "material.tiers.review is light: the check that keeps broken conversions out of tasks works better at standard.", MANIFEST));
  const items = m.items && Object.hasOwn(h.data, m.items.collection) ? h.data[m.items.collection] : undefined;
  if (m.items && h.scopes && items && !items.scoped)
    out.push(
      warning(
        "material-items-scope",
        `material.items uses "${m.items.collection}", which is app-wide: every scope's material links to the same items. Make it \`scoped\` if each scope has its own.`,
        MANIFEST,
      ),
    );
  return out;
}

function permissionFindings(h: LoadedHarness, doc: HarnessDoc | null): Finding[] {
  const wide: [PermissionKey, string][] = [];
  if (h.permissions.edit === "folder") wide.push(["edit", "folder"]);
  if (h.permissions.exec) wide.push(["exec", "true"]);
  if (h.permissions.web) wide.push(["web", "true"]);
  return wide.flatMap(([key, value]) => {
    const line = doc?.permissions.find((p) => p.key === key);
    return line?.reason ? [] : [warning("permissions-wide", `${key}: ${value} has no reason in HARNESS.md → Permissions and engines.`, HARNESS_MD, line?.line)];
  });
}

function openQuestionFindings(doc: HarnessDoc | null): Finding[] {
  const section = doc?.sections.get("Open questions");
  return section && sectionText(section)
    ? [warning("open-questions", "HARNESS.md → Open questions is not empty: settle them, or keep them open on purpose.", HARNESS_MD, section.line)]
    : [];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line per finding, then the counts. */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "No problems found.\n";
  const lines = findings.map((f) => `${f.severity.padEnd(8)}${f.rule.padEnd(21)}${(f.line ? `${f.file}:${f.line}` : f.file).padEnd(22)}${f.message}`);
  const errors = findings.filter((f) => f.severity === "error").length;
  return `${lines.join("\n")}\n\n${plural(errors, "error")}, ${plural(findings.length - errors, "warning")}\n`;
}

export async function checkCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommand(args, { json: { type: "boolean" }, harness: { type: "string" } });
  if (positionals.length > 0) throw new UsageError("Usage: humanharness check [--json] [--harness <dir>]");
  const { findings } = await checkHarness(path.resolve(io.cwd, values.harness ?? "."));
  io.stdout.write(values.json ? `${JSON.stringify(findings, null, 2)}\n` : formatFindings(findings));
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}
