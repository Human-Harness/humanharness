import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type LoadedHarness,
  PLUGIN_API,
  type PluginManifest,
  type SlotKind,
  checkPluginModels,
  harnessSlots,
  hostAllowed,
  loadHarness,
  parsePluginManifest,
  promptPlaceholders,
  slotFor,
} from "@humanharness/harness-sdk";
import { findBrand } from "./check";
import { CliError } from "./cli";
import { MANIFEST } from "./paths";
import { buildPlugin } from "./plugin-build";
import { PLUGIN_MD, type PluginDoc, parsePluginMd } from "./plugin-md";

export type PluginRule =
  | "schema"
  | "api-version"
  | "host-undeclared"
  | "exec-undeclared"
  | "secret-undeclared"
  | "slot-unknown"
  | "fixtures-missing"
  | "plugin-md-mismatch"
  | "prompt-placeholder"
  | "exec-wide"
  | "exec-writes"
  | "hosts-wildcard"
  | "sync-heavy"
  | "host-local"
  | "http-url"
  | "brand"
  | "search-panel";

export interface PluginFinding {
  rule: PluginRule;
  severity: "error" | "warning";
  message: string;
  /** Relative to the plugin folder; absent for a finding about the whole plugin (a failed build). */
  file?: string;
  line?: number;
}

const finding =
  (severity: PluginFinding["severity"]) =>
  (rule: PluginRule, message: string, file?: string, line?: number): PluginFinding => ({ rule, severity, message, ...(file ? { file } : {}), ...(line ? { line } : {}) });
const error = finding("error");
const warning = finding("warning");

const PLUGIN_JSON = "dist/plugin.json";
/** The fixed scans of Decision 18: never a regex built from plugin input. */
const URL_HOST = /(https?):\/\/([a-z0-9.-]+(?::\d{1,5})?)/gi;
/** An IPv6 literal URL (`https://[::1]/`): URL_HOST never sees one. */
const URL_IPV6 = /https?:\/\/\[[0-9a-f:.]*\]/gi;
const EXEC_CALL = /exec\(\s*["']([A-Za-z0-9._-]+)["']/g;
const SECRET_REF = /\{\{secret:([a-z][a-z0-9_-]*)\}\}/g;
const SCANNED = /\.(ts|tsx|js)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const SYNC_HEAVY_TTL = 60;
const WRITE_ARGS = new Set(["post", "put", "patch", "delete", "rm", "create", "edit", "merge", "close"]);
const METHOD_FLAGS = new Set(["-X", "--method", "--request"]);
const READ_METHODS = new Set(["GET", "HEAD"]);

/**
 * `localhost`, a name under it, or an IP literal: the broker refuses them even when declared (part 1 Decision 8). A
 * trailing `:port` is not part of the name; an IPv6 literal is bracketed or has two colons or more.
 */
function isLocal(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower.startsWith("[") || lower.split(":").length > 2) return true;
  const h = lower.replace(/:\d+$/, "").replace(/^\*\./, "").replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || IPV4.test(h);
}

/**
 * `*.<one label>` (`*.com`): every host under a top-level name. The manifest schema (HOST_PATTERN) already refuses
 * it, so a parsed plugin.json never has one; the warning stays as the spec's rule should HOST_PATTERN ever widen.
 */
export const wildcardOverOneLabel = (host: string): boolean => /^\*\.[a-z0-9-]+(:\d+)?$/i.test(host);

/** A declared exec pattern that may write (Task 16): a method other than GET/HEAD, or a writing verb among its args. */
export function execWrites(args: readonly string[]): boolean {
  return args.some((a, i) => {
    if (METHOD_FLAGS.has(a)) return !READ_METHODS.has((args[i + 1] ?? "").toUpperCase());
    const eq = /^--(method|request)=(.*)$/.exec(a);
    if (eq) return !READ_METHODS.has(eq[2].toUpperCase());
    if (a.startsWith("-X") && a.length > 2) return !READ_METHODS.has(a.slice(2).toUpperCase());
    return WRITE_ARGS.has(a.toLowerCase());
  });
}

/** The manifest from dist/plugin.json, as the app's loader reads it; schema findings when it can't. */
async function readManifest(dir: string, findings: PluginFinding[]): Promise<PluginManifest | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(dir, PLUGIN_JSON), "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    findings.push(error("schema", missing ? `${PLUGIN_JSON} is missing: run humanharness plugin build.` : `${PLUGIN_JSON} is not valid JSON.`, PLUGIN_JSON));
    return null;
  }
  let m: PluginManifest;
  try {
    m = parsePluginManifest(raw);
    checkPluginModels(m);
  } catch (err) {
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (Array.isArray(issues)) for (const i of issues) findings.push(error("schema", `${i.path.map(String).join(".") || "(manifest)"}: ${i.message}`, PLUGIN_JSON));
    else findings.push(error("schema", err instanceof Error ? err.message : String(err), PLUGIN_JSON));
    return null;
  }
  if (m.api !== PLUGIN_API) findings.push(error("api-version", `plugin.json's api is ${m.api}; this core runs plugins of api ${PLUGIN_API}.`, PLUGIN_JSON));
  return m;
}

/** Global search (search spec §7): a searchable collection's records open in a panel; without one, nowhere. */
export function searchFindings(m: PluginManifest): PluginFinding[] {
  const names = Object.entries(m.data)
    .filter(([, c]) => c.search)
    .map(([name]) => name);
  if (m.panels.length > 0) return [];
  // One per collection, as the harness check's search-data.
  return names.map((n) => warning("search-panel", `"${n}" is searchable but the plugin has no panel: its records would open nowhere. Add a panel, or drop its search.`, PLUGIN_JSON));
}

function manifestFindings(m: PluginManifest): PluginFinding[] {
  const out: PluginFinding[] = [];
  // As the harness check's brand rule: a plugin named after a provider would look made or endorsed by it.
  const brand = findBrand(m.name);
  if (brand) out.push(error("brand", `The plugin's name "${m.name}" uses the word "${brand}", a provider or model brand: the plugin would look made or endorsed by that provider. Use no provider or model brands in its name.`, PLUGIN_JSON));
  for (const host of m.permissions.hosts) {
    if (isLocal(host)) out.push(warning("host-local", `"${host}": the broker refuses localhost and IP addresses even when declared.`, PLUGIN_JSON));
    else if (wildcardOverOneLabel(host)) out.push(warning("hosts-wildcard", `"${host}" allows every host under a top-level name: name the service's own domain.`, PLUGIN_JSON));
  }
  for (const e of m.permissions.exec) {
    const shown = [e.cmd, ...e.args].join(" ");
    if (e.args.length === 1 && e.args[0] === "*") out.push(warning("exec-wide", `"${shown}" allows any arguments: pin the read-only form.`, PLUGIN_JSON));
    if (execWrites(e.args)) out.push(warning("exec-writes", `"${shown}" may write: pin a read-only form, or say in PLUGIN.md why it stays.`, PLUGIN_JSON));
  }
  for (const s of m.sources) {
    if (s.ttl < SYNC_HEAVY_TTL) out.push(warning("sync-heavy", `Source "${s.id}" syncs every ${s.ttl} s: does the data change that fast?`, PLUGIN_JSON));
  }
  for (const a of m.actions) {
    const props = (typeof a.vars.properties === "object" && a.vars.properties !== null ? a.vars.properties : {}) as Record<string, { default?: unknown }>;
    const used = promptPlaceholders(a.prompt);
    for (const name of used) {
      if (!Object.hasOwn(props, name)) out.push(error("prompt-placeholder", `actions "${a.id}": the prompt uses {{${name}}}, which is not a declared var`, PLUGIN_JSON));
    }
    const required = Array.isArray(a.vars.required) ? (a.vars.required as unknown[]).filter((r): r is string => typeof r === "string") : [];
    for (const name of required) {
      // zod's output lists a defaulted field as required; the person never has to give it, so it may go unused.
      const defaulted = Object.hasOwn(props, name) && props[name]?.default !== undefined;
      if (!defaulted && !used.includes(name)) out.push(error("prompt-placeholder", `actions "${a.id}": the required var "${name}" is never used in the prompt`, PLUGIN_JSON));
    }
  }
  return out;
}

/** The files the source scans read: backend.ts, panels/** and src/** (.ts, .tsx, .js), no links, no node_modules. */
async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  if ((await fs.lstat(path.join(dir, "backend.ts")).catch(() => null))?.isFile()) files.push("backend.ts");
  const walk = async (rel: string): Promise<void> => {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory() && e.name !== "node_modules") await walk(child);
      else if (e.isFile() && SCANNED.test(e.name)) files.push(child);
    }
  };
  await walk("panels");
  await walk("src");
  return files;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Literal hosts, commands and key references in the sources against plugin.json (Decision 18; Open question 12). */
async function sourceFindings(dir: string, m: PluginManifest): Promise<PluginFinding[]> {
  const out: PluginFinding[] = [];
  const cmds = new Set(m.permissions.exec.map((e) => e.cmd));
  const keys = new Set(m.permissions.secrets.map((s) => s.id));
  for (const file of await sourceFiles(dir)) {
    const text = await fs.readFile(path.join(dir, file), "utf8");
    const seen = new Set<string>();
    const once = (key: string) => !seen.has(key) && !!seen.add(key);
    for (const hit of text.matchAll(URL_HOST)) {
      // host[:port], dots before the port or at the end dropped: the broker matches the port too.
      const host = hit[2].toLowerCase().replace(/\.+(?=:|$)/, "");
      // An XML namespace (an inline SVG's xmlns) names a vocabulary; nothing fetches it.
      if (host === "" || host.startsWith(":") || host === "www.w3.org") continue;
      const line = lineOf(text, hit.index);
      if (isLocal(host)) {
        if (once(`host:${host}`)) out.push(warning("host-local", `${host}: the broker refuses localhost and IP addresses, even when declared.`, file, line));
        continue;
      }
      if (hit[1].toLowerCase() === "http" && once(`http:${host}`)) out.push(warning("http-url", `http://${host}: the broker only fetches https, even from a declared host.`, file, line));
      if (once(`host:${host}`) && !hostAllowed(`https://${host}/`, m.permissions.hosts)) out.push(error("host-undeclared", `${host} is not in permissions.hosts.`, file, line));
    }
    for (const hit of text.matchAll(URL_IPV6)) {
      if (once(`host:${hit[0].toLowerCase()}`)) out.push(warning("host-local", `${hit[0]}: the broker refuses localhost and IP addresses, even when declared.`, file, lineOf(text, hit.index)));
    }
    for (const hit of text.matchAll(EXEC_CALL)) {
      if (once(`exec:${hit[1]}`) && !cmds.has(hit[1])) out.push(error("exec-undeclared", `exec("${hit[1]}") is not in permissions.exec.`, file, lineOf(text, hit.index)));
    }
    for (const hit of text.matchAll(SECRET_REF)) {
      if (once(`key:${hit[1]}`) && !keys.has(hit[1])) out.push(error("secret-undeclared", `{{secret:${hit[1]}}}: the key "${hit[1]}" is not in permissions.secrets.`, file, lineOf(text, hit.index)));
    }
  }
  return out;
}

async function fixtureFindings(dir: string, m: PluginManifest): Promise<PluginFinding[]> {
  const out: PluginFinding[] = [];
  for (const s of m.sources) {
    const folder = `fixtures/${s.id}`;
    const entries = await fs.readdir(path.join(dir, folder), { withFileTypes: true }).catch(() => []);
    if (!entries.some((e) => e.isFile() && e.name.endsWith(".json"))) {
      out.push(error("fixtures-missing", `Source "${s.id}" has no fixtures: run humanharness plugin record ${s.id}.`, folder));
    }
  }
  return out;
}

const mdError = (message: string, line?: number) => error("plugin-md-mismatch", message, PLUGIN_MD, line);

/** Each item of `doc` the manifest lacks, then each the manifest has and `doc` lacks. */
function differ(label: string, doc: string[], declared: string[], line?: number): PluginFinding[] {
  return [
    ...doc.filter((x) => !declared.includes(x)).map((x) => mdError(`PLUGIN.md → Permissions has "${label}: ${x}", which plugin.json doesn't declare`, line)),
    ...declared.filter((x) => !doc.includes(x)).map((x) => mdError(`PLUGIN.md → Permissions has no "${label}: ${x}" line`, line)),
  ];
}

/** PLUGIN.md's Sources table and permission bullets against plugin.json (Decision 19). */
function pluginMdFindings(doc: PluginDoc | null, m: PluginManifest): PluginFinding[] {
  if (!doc) return [mdError("PLUGIN.md is missing: write it as the /new-plugin guide says.")];
  const out: PluginFinding[] = [];
  const sourcesLine = doc.sections.get("Sources")?.line;
  if (doc.sources === null) {
    if (m.sources.length > 0) out.push(mdError("PLUGIN.md → Sources has no | Source | Brings | TTL | table", sourcesLine));
  } else {
    for (const row of doc.sources) {
      const s = m.sources.find((x) => x.id === row.id);
      if (!s) out.push(mdError(`PLUGIN.md → Sources lists "${row.id}", which plugin.json doesn't declare`, row.line));
      else if (row.ttl === null) out.push(mdError(`PLUGIN.md → Sources: the TTL of "${row.id}" isn't a duration (300, 300 s, 5 min, 6 h)`, row.line));
      else if (row.ttl !== s.ttl) out.push(mdError(`PLUGIN.md → Sources says "${row.id}" syncs every ${row.ttl} s; plugin.json says ${s.ttl} s`, row.line));
    }
    for (const s of m.sources) {
      if (!doc.sources.some((r) => r.id === s.id)) out.push(mdError(`PLUGIN.md → Sources doesn't list the source "${s.id}"`, sourcesLine));
    }
  }
  const p = doc.permissions;
  const line = doc.sections.get("Permissions")?.line;
  out.push(...differ("Host", p.hosts, m.permissions.hosts.map((h) => h.toLowerCase()), line));
  out.push(...differ("Runs", p.exec, m.permissions.exec.map((e) => [e.cmd, ...e.args].join(" ")), line));
  out.push(...differ("Key", p.keys, m.permissions.secrets.map((s) => s.id), line));
  if (p.tasks && !m.permissions.tasks) out.push(mdError(`PLUGIN.md → Permissions has "Tasks", but plugin.json doesn't set permissions.tasks`, line));
  if (!p.tasks && m.permissions.tasks) out.push(mdError(`PLUGIN.md → Permissions has no "Tasks" line`, line));
  return out;
}

/** Panels and chips naming a slot the harness doesn't have with that kind (`--harness` only). */
function slotFindings(h: LoadedHarness, m: PluginManifest): PluginFinding[] {
  const slots = harnessSlots(h);
  const out: PluginFinding[] = [];
  const check = (kind: SlotKind, list: { id: string; slot?: string }[], label: string) => {
    for (const x of list) {
      if (x.slot === undefined || slots.some((s) => s.id === x.slot && s.kind === kind)) continue;
      out.push(error("slot-unknown", `${label} "${x.id}": the harness has no ${kind} slot "${x.slot}" (it would go in "${slotFor(h, kind, x.slot)}")`, PLUGIN_JSON));
    }
  };
  check("panel", m.panels, "panels");
  check("chip", m.chips, "chips");
  return out;
}

async function readHarness(dir: string): Promise<LoadedHarness> {
  try {
    return await loadHarness(path.join(dir, MANIFEST));
  } catch (err) {
    throw new CliError(`--harness: can't load ${path.join(dir, MANIFEST)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * `humanharness plugin check` (spec §9.2, Decisions 18–19): builds the plugin (unless `build: false`), then checks
 * dist/plugin.json, the sources, the fixtures and PLUGIN.md. Errors make the CLI exit with 1.
 */
export async function checkPlugin(dir: string, o: { harness?: string; build?: boolean } = {}): Promise<{ manifest: PluginManifest | null; findings: PluginFinding[] }> {
  const root = path.resolve(dir);
  const harness = o.harness === undefined ? null : await readHarness(path.resolve(o.harness));
  const findings: PluginFinding[] = [];
  if (o.build !== false) {
    try {
      await buildPlugin(root);
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      findings.push(error("schema", `The build failed: ${err.message}`));
      return { manifest: null, findings };
    }
  }
  const m = await readManifest(root, findings);
  if (!m) return { manifest: null, findings };
  findings.push(...manifestFindings(m));
  findings.push(...searchFindings(m));
  if (harness) findings.push(...slotFindings(harness, m));
  findings.push(...(await sourceFindings(root, m)));
  findings.push(...(await fixtureFindings(root, m)));
  const md = await fs.readFile(path.join(root, PLUGIN_MD), "utf8").catch(() => null);
  findings.push(...pluginMdFindings(md === null ? null : parsePluginMd(md), m));
  return { manifest: m, findings };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line per finding, then the counts: the harness `check`'s format. */
export function formatPluginFindings(findings: PluginFinding[]): string {
  if (findings.length === 0) return "No problems found.\n";
  const where = (f: PluginFinding) => (f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : "");
  const lines = findings.map((f) => `${f.severity.padEnd(8)}${f.rule.padEnd(21)}${where(f).padEnd(22)}${f.message}`);
  const errors = findings.filter((f) => f.severity === "error").length;
  return `${lines.join("\n")}\n\n${plural(errors, "error")}, ${plural(findings.length - errors, "warning")}\n`;
}
