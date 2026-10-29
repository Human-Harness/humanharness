import path from "node:path";
import { fixtureTransport } from "@humanharness/harness-sdk/plugin-fixtures";
import { readPluginFixtures, type runFile } from "@humanharness/shell/plugins";
import { CliError } from "./cli";
import { type RunReport, readBuiltManifest, runSource } from "./plugin-run";

/** P12, printed once per run before any plugin code runs. */
export const P12_NOTE = "Note: plugin code runs in this Node process, not in the app's sandbox. Run only plugins you trust.";

/** A fixture run's keys: each one is `fixture-<id>`, so no real key is ever asked for or sent. */
export async function fixtureSecrets(ids: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(ids.map((id) => [id, `fixture-${id}`]));
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
    // The app's fixture reader (one copy, same caps and link rules); a skipped file is a warn line in the report.
    const skipped: string[] = [];
    const note = (message: string, err?: unknown) => skipped.push(err === undefined ? message : `${message}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    const transport = fixtureTransport(await readPluginFixtures(path.join(dir, "fixtures"), source, note)) as unknown as { fetch: typeof fetch; run: typeof runFile };
    const report = await runSource({
      dir,
      source,
      transport,
      secrets: fixtureSecrets,
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
