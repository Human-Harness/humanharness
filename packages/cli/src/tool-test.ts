import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type Collection, type DataKey, type LoadedHarness, hasTools, loadHarness } from "@humanharness/harness-sdk";
import { fixtureTransport } from "@humanharness/harness-sdk/plugin-fixtures";
import type { ToolFixture } from "@humanharness/harness-sdk/tool-fixtures";
import type { BrokerDataOp, runFile } from "@humanharness/shell/plugins";
import { type TraceEntry, readToolFixtures } from "@humanharness/shell/tools";
import { CliError, UsageError } from "./cli";
import { MANIFEST } from "./paths";
import { fixtureSecrets } from "./plugin-test";
import { buildTools } from "./tool-build";
import { TOOL_P12_NOTE, cliTools } from "./tool-host-node";

/** "This harness declares no tools." (D0): every `tool` command refuses with it. */
export const NO_TOOLS = "This harness declares no tools.";

/** One data write a fixture's call made: reported, never saved (Decision 3). */
export interface ToolWrite {
  collection: string;
  op: "put" | "patch" | "delete";
  key?: DataKey;
}

export interface ToolCaseResult {
  /** The fixture's file name under `tools/<id>/fixtures/`. */
  file: string;
  ok: boolean;
  /** Why it failed: one line. */
  why?: string;
  writes: ToolWrite[];
  /** The call's trace entries (keys hidden by the registry). */
  trace: TraceEntry[];
}

export interface ToolTestReport {
  tool: string;
  cases: ToolCaseResult[];
  /** Fixture files that weren't valid cases (the reader's notes). */
  skipped: string[];
}

/** How much of a value a reason shows. */
const SHOWN = 500;
const shown = (v: unknown): string => {
  let text: string;
  try {
    text = JSON.stringify(v) ?? "undefined";
  } catch {
    text = String(v);
  }
  return text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text;
};
/** The value as JSON carries it, so a fixture's JSON and a tool's result compare alike (Decision 2). */
const asJson = (v: unknown): unknown => {
  const text = JSON.stringify(v);
  return text === undefined ? null : JSON.parse(text);
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isKey = (v: unknown): v is DataKey => typeof v === "string" || typeof v === "number";

/**
 * A fixture's `ctx.data` (Decision 3): one Map per collection of the manifest, seeded from the fixture's `data`;
 * `get` and `query` answer from it as the app's store does, `put`, `patch` and `delete` change it and are listed in
 * `writes`. Nothing reaches a file. Collections and keys are looked up with Map and Object.hasOwn only (A4).
 */
function memoryData(collections: Record<string, Collection>, seed: ToolFixture["data"], writes: ToolWrite[]) {
  const stores = new Map<string, Map<DataKey, Record<string, unknown>>>();
  const collectionOf = (name: string): Collection => {
    if (!Object.hasOwn(collections, name)) throw new Error(`No collection "${name}"`);
    return collections[name]!;
  };
  const storeOf = (name: string) => {
    let s = stores.get(name);
    if (!s) {
      s = new Map();
      stores.set(name, s);
    }
    return s;
  };
  const keyOf = (name: string, c: Collection, record: Record<string, unknown>): DataKey => {
    if (c.single) return "";
    const k = Object.hasOwn(record, c.key!) ? record[c.key!] : undefined;
    if (!isKey(k)) throw new Error(`A record of "${name}" needs its key "${c.key}"`);
    return k;
  };
  const checked = (name: string, c: Collection, record: unknown): Record<string, unknown> => {
    const r = c.schema.safeParse(record);
    if (!r.success) throw new Error(`Not a record of "${name}": ${r.error.issues[0]?.message ?? "invalid"}`);
    return r.data as Record<string, unknown>;
  };
  for (const [name, records] of Object.entries(seed ?? {})) {
    const c = collectionOf(name);
    const s = storeOf(name);
    // A seeded record is checked as a put would be: a fixture can't start from data the app would refuse.
    for (const r of records) {
      const record = checked(name, c, r);
      s.set(keyOf(name, c, record), record);
    }
  }
  return async (op: BrokerDataOp): Promise<unknown> => {
    const c = collectionOf(op.collection);
    const s = storeOf(op.collection);
    const needKey = (key: DataKey | undefined): DataKey => {
      if (c.single) return "";
      if (!isKey(key)) throw new Error("A key is needed");
      return key;
    };
    switch (op.op) {
      case "get": {
        const r = s.get(needKey(op.key));
        return r ? structuredClone(r) : null;
      }
      case "query": {
        const where = Object.entries(isRecord(op.query.where) ? op.query.where : {});
        const matches = [...s.values()].filter((r) =>
          where.every(([field, cond]) => {
            const v = Object.hasOwn(r, field) ? r[field] : undefined;
            return isRecord(cond) && Array.isArray(cond.in) ? cond.in.includes(v) : v === cond;
          }),
        );
        const limit = typeof op.query.limit === "number" && Number.isFinite(op.query.limit) ? Math.max(1, Math.trunc(op.query.limit)) : 50;
        const fields = op.query.fields?.length ? [...new Set([...(c.key ? [c.key] : []), ...op.query.fields])] : null;
        const pick = (r: Record<string, unknown>) => (fields ? Object.fromEntries(fields.filter((f) => Object.hasOwn(r, f)).map((f) => [f, r[f]])) : r);
        return { records: structuredClone(matches.slice(0, Math.min(limit, 200)).map(pick)), total: matches.length, invalid: 0 };
      }
      case "put": {
        const next = checked(op.collection, c, op.record);
        const key = keyOf(op.collection, c, next);
        s.set(key, next);
        writes.push({ collection: op.collection, op: "put", ...(c.single ? {} : { key }) });
        return structuredClone(next);
      }
      case "patch": {
        const key = needKey(op.key);
        const prev = s.get(key);
        if (!prev) throw new Error(c.single ? `"${op.collection}" has no record yet` : `"${op.collection}" has no record "${String(key)}"`);
        if (!c.single && Object.hasOwn(op.patch, c.key!) && op.patch[c.key!] !== key) throw new Error(`The key "${c.key}" can't change`);
        const next = checked(op.collection, c, { ...prev, ...op.patch });
        s.set(key, next);
        writes.push({ collection: op.collection, op: "patch", ...(c.single ? {} : { key }) });
        return structuredClone(next);
      }
      case "delete": {
        const key = needKey(op.key);
        if (!s.delete(key)) return false;
        writes.push({ collection: op.collection, op: "delete", ...(c.single ? {} : { key }) });
        return true;
      }
      default:
        throw new Error("Unknown call");
    }
  };
}

/** Writes a fixture's `files` into `folder`; each path joined, then checked to stay inside (A4, second guard). */
async function writeFiles(folder: string, files: ToolFixture["files"]): Promise<void> {
  for (const [rel, text] of Object.entries(files ?? {})) {
    const target = path.join(folder, rel);
    const inside = path.relative(folder, target);
    if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error(`files: "${rel.slice(0, 200)}" is outside the folder`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, { flag: "wx" });
  }
}

/** Pass or fail (Decision 2): the reason, or null when the answer is what the fixture expects. */
function verdict(expect: ToolFixture["expect"], answer: { ok: true; result: unknown } | { ok: false; error: string }): string | null {
  if ("error" in expect) {
    if (!answer.ok) return answer.error.includes(expect.error) ? null : `expected an error with ${JSON.stringify(expect.error)} got ${JSON.stringify(answer.error)}`;
    return `expected an error with ${JSON.stringify(expect.error)} got the result ${shown(answer.result)}`;
  }
  if (!answer.ok) return `expected ${shown(expect.result)} got the error ${JSON.stringify(answer.error)}`;
  let got: unknown;
  try {
    got = asJson(answer.result);
  } catch (err) {
    // A BigInt or a cycle: JSON can't carry it, so it can't equal what a fixture file holds.
    return `expected ${shown(expect.result)} got a result that isn't JSON: ${errText(err)}`;
  }
  return isDeepStrictEqual(got, asJson(expect.result)) ? null : `expected ${shown(expect.result)} got ${shown(answer.result)}`;
}

/**
 * `humanharness tool test [<id>]` (tools spec §11, Decisions 1–3): the harness's tools built in memory, then each
 * tool's `tools/<id>/fixtures/*.json` run through the app's registry and broker (cliTools), each case with keys as
 * `fixture-<id>`, fetch and exec answered only from its exchanges, `ctx.data` in memory and `ctx.files` a temp folder
 * removed after. The P12 note for tools goes to `out` once, before any tool code runs (the build runs it too).
 * `temp` is where the temp folders go (the system's temp folder by default).
 */
export async function testTools(dir: string, o: { tool?: string; out: { write(text: string): unknown }; temp?: string }): Promise<ToolTestReport[]> {
  const root = path.resolve(dir);
  const harness: LoadedHarness = await loadHarness(path.join(root, MANIFEST));
  if (!hasTools(harness)) throw new CliError(NO_TOOLS);
  const ids = Object.keys(harness.tools ?? {}).sort();
  if (o.tool !== undefined && !ids.includes(o.tool)) throw new UsageError(`"${o.tool.slice(0, 64)}" is not a tool of ${harness.id}: ${ids.join(", ")}.`);
  o.out.write(`${TOOL_P12_NOTE}\n`);
  // A build problem is a CliError (ToolBuildError) with its text.
  const { files } = await buildTools(root, { write: false, harness });
  const base = o.temp ?? os.tmpdir();
  // The registry and host read dist/ from a root of their own: the harness's own dist/ is never touched.
  const built = await fs.mkdtemp(path.join(base, "hh-tool-test-"));
  try {
    await fs.mkdir(path.join(built, "dist", "tools"), { recursive: true });
    for (const [name, content] of files) await fs.writeFile(path.join(built, "dist", ...name.split("/")), content);
    const reports: ToolTestReport[] = [];
    for (const tool of o.tool !== undefined ? [o.tool] : ids) {
      const skipped: string[] = [];
      const fixtures = await readToolFixtures(root, tool, (message, err) => skipped.push(err === undefined ? message : `${message}: ${errText(err)}`));
      const cases: ToolCaseResult[] = [];
      for (const { file, fixture } of fixtures) cases.push(await runCase(harness, built, base, tool, file, fixture));
      reports.push({ tool, cases, skipped });
    }
    return reports;
  } finally {
    await fs.rm(built, { recursive: true, force: true });
  }
}

async function runCase(harness: LoadedHarness, built: string, base: string, tool: string, file: string, f: ToolFixture): Promise<ToolCaseResult> {
  const writes: ToolWrite[] = [];
  const folder = await fs.mkdtemp(path.join(base, "hh-tool-files-"));
  let tools: ReturnType<typeof cliTools> | null = null;
  try {
    let data: ReturnType<typeof memoryData>;
    try {
      await writeFiles(folder, f.files);
      data = memoryData(harness.data, f.data, writes);
    } catch (err) {
      return { file, ok: false, why: errText(err), writes, trace: [] };
    }
    const transport = fixtureTransport(f.exchanges ?? []) as unknown as { fetch: typeof fetch; run: typeof runFile };
    tools = cliTools({
      root: built,
      harness,
      transport: () => transport,
      secrets: fixtureSecrets,
      // Nothing reaches the network: every fetch is answered by the exchanges.
      allowHost: async () => true,
      data: (op) => data(op),
      folder: { base: folder, references: [] },
    });
    const answer = await tools.registry.call({ tool, args: f.args, caller: "ui", scope: f.scope, ...(f.inputs ? { inputs: f.inputs } : {}) });
    const why = verdict(f.expect, answer.ok ? { ok: true, result: answer.result } : { ok: false, error: answer.error });
    return { file, ok: why === null, ...(why !== null ? { why } : {}), writes, trace: [...tools.entries] };
  } finally {
    tools?.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const writeText = (w: ToolWrite) => `${w.op} ${w.collection}${w.key !== undefined ? ` ${String(w.key)}` : ""}`;

/** Per tool its count and failures, per failing case why and its trace, then one last line. */
export function formatToolReports(reports: ToolTestReport[]): string {
  const out: string[] = [];
  for (const r of reports) {
    const failed = r.cases.filter((c) => !c.ok).length;
    out.push(r.cases.length === 0 ? `${r.tool}: ${r.skipped.length > 0 ? "no valid fixtures" : "no fixtures"}` : `${r.tool}: ${plural(r.cases.length, "fixture")}, ${failed} failed`);
    for (const s of r.skipped) out.push(`  warn: ${s}`);
    for (const c of r.cases) {
      const writes = c.writes.length > 0 ? `${plural(c.writes.length, "write")}: ${c.writes.map(writeText).join(", ")}` : "";
      if (c.ok) {
        if (writes) out.push(`  ${c.file}: ok, ${writes}`);
        continue;
      }
      out.push(`  ${c.file}: ${c.why ?? "failed"}`);
      if (writes) out.push(`    ${writes}`);
      for (const e of c.trace) {
        out.push(`    call: ${e.tool} · ${e.ms} ms · ${e.ok ? "ok" : "failed"}${e.error !== undefined ? `: ${e.error.split("\n")[0]}` : ""}`);
        for (const a of e.accesses) out.push(`      ${a.kind} ${a.target}${a.allowed ? "" : " (denied)"}`);
      }
    }
  }
  const total = reports.reduce((n, r) => n + r.cases.length, 0);
  const failed = reports.reduce((n, r) => n + r.cases.filter((c) => !c.ok).length, 0);
  out.push("", failed === 0 ? `${plural(total, "fixture")} passed.` : `${failed} of ${total} fixtures failed.`);
  return `${out.join("\n")}\n`;
}

/** One `tool-fixture` problem for `check`: the message and the fixture file, relative to the harness folder. */
export interface ToolFixtureProblem {
  message: string;
  file: string;
}

/** Why a fixture file was skipped, in one line: a schema refusal names its first issue, not zod's JSON. */
const skippedWhy = (err: unknown): string => {
  const issues = (err as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0] as { path?: unknown[]; message?: unknown };
    const at = Array.isArray(first.path) && first.path.length > 0 ? `${first.path.map(String).join(".")}: ` : "";
    return `${at}${String(first.message ?? "invalid")}`;
  }
  return errText(err);
};

/**
 * `check`'s rule `tool-fixture` (tools spec §3.3, Decision 4): every tool's `tools/<id>/fixtures/*.json` run as
 * `tool test` runs them (`runCase`), from bundles `check`'s in-memory build already made (`files`). Each failing case and
 * each file that isn't a valid case is one problem: `Tool "<id>": fixtures/<file>: <why>`. When no tool has a valid
 * case nothing runs and `note` is never called; else the P12 note for tools goes to `note` once, before any fixture runs.
 */
export async function toolFixtureFindings(
  root: string,
  harness: LoadedHarness,
  files: Map<string, Uint8Array | string>,
  o: { note(line: string): void; temp?: string },
): Promise<ToolFixtureProblem[]> {
  const problems: ToolFixtureProblem[] = [];
  const runs: { tool: string; file: string; fixture: ToolFixture }[] = [];
  for (const tool of Object.keys(harness.tools ?? {}).sort()) {
    const fixtures = await readToolFixtures(root, tool, (message, err) => {
      const file = message.replace(/ skipped$/, "");
      problems.push({ message: `Tool "${tool}": ${file.slice(`tools/${tool}/`.length)}: ${skippedWhy(err)}`, file });
    });
    for (const f of fixtures) runs.push({ tool, ...f });
  }
  if (runs.length === 0) return problems;
  o.note(TOOL_P12_NOTE);
  const base = o.temp ?? os.tmpdir();
  const built = await fs.mkdtemp(path.join(base, "hh-tool-check-"));
  try {
    await fs.mkdir(path.join(built, "dist", "tools"), { recursive: true });
    for (const [name, content] of files) await fs.writeFile(path.join(built, "dist", ...name.split("/")), content);
    for (const { tool, file, fixture } of runs) {
      let why: string | null;
      try {
        const c = await runCase(harness, built, base, tool, file, fixture);
        why = c.ok ? null : (c.why ?? "failed");
      } catch (err) {
        // A case that couldn't run (its temp folder, say): a finding, never a crashed check. A result JSON can't carry
        // is the verdict's own reason.
        why = errText(err);
      }
      if (why !== null) problems.push({ message: `Tool "${tool}": fixtures/${file}: ${why}`, file: `tools/${tool}/fixtures/${file}` });
    }
  } finally {
    await fs.rm(built, { recursive: true, force: true });
  }
  // Per tool, in file-name order, whether the file was skipped or ran.
  return problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
