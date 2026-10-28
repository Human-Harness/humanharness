import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { type FixtureExchange, fixtureTransport, parseFixture } from "@humanharness/harness-sdk/plugin-fixtures";
import type { runFile } from "@humanharness/shell/plugins";
import { CliError } from "./cli";
import { type RunReport, readBuiltManifest, runSource } from "./plugin-run";

/** P12, printed once per run before any plugin code runs. */
export const P12_NOTE = "Note: plugin code runs in this Node process, not in the app's sandbox. Run only plugins you trust.";

/** The app's fixture caps (Decision 14): at most this many files of at most this size per source. */
const FIXTURE_FILES = 200;
const FIXTURE_BYTES = 10 * 1024 * 1024;

/**
 * `fixtures/<source>/*.json` in file-name order, as the app's fixture mode reads them: links aren't followed, and a
 * file that isn't a valid exchange is skipped with a line in `skipped`. A missing folder is no fixtures.
 */
export async function readFixtures(dir: string, source: string, skipped: string[] = []): Promise<FixtureExchange[]> {
  const root = path.join(dir, "fixtures");
  const folder = path.join(root, source);
  const isDir = async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;
  if (!(await isDir(root)) || !(await isDir(folder))) return [];
  const names = (await fs.readdir(folder, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => d.name)
    .sort()
    .slice(0, FIXTURE_FILES);
  const out: FixtureExchange[] = [];
  for (const name of names) {
    let file: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      file = await fs.open(path.join(folder, name), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const st = await file.stat();
      if (!st.isFile()) throw new Error("not a file");
      if (st.size > FIXTURE_BYTES) throw new Error("larger than 10 MB");
      out.push(parseFixture(JSON.parse(await file.readFile("utf8"))));
    } catch (err) {
      skipped.push(`fixtures/${source}/${name} skipped: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
  return out;
}

/**
 * `humanharness plugin test` (spec §9, Decision 21): every source (or `source`) of the built plugin once, on its
 * fixtures, with settings at their defaults and each key as `fixture-<id>`. Nothing reaches the network or a process.
 */
export async function testPlugin(dir: string, o: { source?: string; now?: Date } = {}): Promise<RunReport[]> {
  const m = await readBuiltManifest(dir);
  const ids = m.sources.map((s) => s.id);
  if (o.source !== undefined && !ids.includes(o.source)) throw new CliError(`--source: "${o.source}" is not a source of ${m.id} (${ids.join(", ") || "none"}).`);
  const reports: RunReport[] = [];
  for (const source of o.source !== undefined ? [o.source] : ids) {
    const skipped: string[] = [];
    const transport = fixtureTransport(await readFixtures(dir, source, skipped)) as unknown as { fetch: typeof fetch; run: typeof runFile };
    const report = await runSource({
      dir,
      source,
      transport,
      secrets: async (keys) => Object.fromEntries(keys.map((k) => [k, `fixture-${k}`])),
      ...(o.now ? { now: o.now } : {}),
    });
    report.log.unshift(...skipped.map((s) => `warn: ${s}`));
    reports.push(report);
  }
  return reports;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Per source: the result, the records written by collection, the attention items, the chips and the log. */
export function formatTestReports(reports: RunReport[]): string {
  const out: string[] = [];
  for (const r of reports) {
    out.push(`${r.source}: ${r.ok ? "ok" : `FAILED: ${r.error ?? "unknown error"}`}`);
    const writes = Object.entries(r.writes);
    out.push(writes.length === 0 ? "  records: none written" : "  records:");
    for (const [c, w] of writes) out.push(`    ${c}: ${plural(w.count, "record")}${w.keys.length > 0 ? ` (${w.keys.join(", ")}${w.count > w.keys.length ? ", …" : ""})` : ""}`);
    out.push(r.attention.length === 0 ? "  attention: none" : "  attention:");
    for (const a of r.attention) out.push(`    [${a.severity}] ${a.key}: ${a.title}`);
    const chips = Object.entries(r.chips);
    out.push(chips.length === 0 ? "  chips: none" : "  chips:");
    for (const [id, text] of chips) out.push(`    ${id}: ${text}`);
    if (r.log.length > 0) {
      out.push("  log:");
      for (const line of r.log) out.push(`    ${line}`);
    }
  }
  const failed = reports.filter((r) => !r.ok).length;
  out.push("", failed === 0 ? `${plural(reports.length, "source")} ran on fixtures.` : `${plural(failed, "source")} of ${reports.length} failed.`);
  return `${out.join("\n")}\n`;
}
