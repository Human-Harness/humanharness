import { promises as fs } from "node:fs";
import path from "node:path";
import { TOOL_ID } from "@humanharness/harness-sdk";
import { type FixtureExchange, fixtureTransport, parseFixture } from "@humanharness/harness-sdk/plugin-fixtures";
import { readFixtureFiles } from "../plugin-fixture-files";
import type { runFile } from "../plugin-exec";

/** "No fixture for X" from the fixture transport, as mock mode says it (tools spec §12). */
const NO_FIXTURE = "No fixture for ";

/**
 * A tool's recorded exchanges as its fetch and exec in mock mode (A2): each request plays the first unused match, as
 * plugins' fixtures do, and nothing reaches the network or a process; an unmatched access fails "Not recorded: <target>"
 * ("Not recorded: GET https://…", "Not recorded: gh pr checks 12").
 */
export function recordedToolTransport(exchanges: FixtureExchange[]): { fetch: typeof fetch; run: typeof runFile } {
  const t = fixtureTransport(exchanges);
  const rename = (err: unknown): never => {
    if (err instanceof Error && err.message.startsWith(NO_FIXTURE)) throw new Error(`Not recorded: ${err.message.slice(NO_FIXTURE.length)}`);
    throw err;
  };
  return {
    fetch: ((input: string | URL | Request, init?: RequestInit) => t.fetch(input, init).catch(rename)) as typeof fetch,
    run: ((file, args, o) => t.run(file, args, o).catch(rename)) as typeof runFile,
  };
}

const isDir = async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;

/**
 * `<dir>/<tool>/*.json` (`mock/tools/<tool>/<NNN>.json`, tools Decision 8: one exchange per file in the plugin fixture
 * format, as `run --record` writes them), with the plugin fixture files' rules (A4: count and size caps, no links, `dir`
 * and `<tool>/` real folders). A file that isn't a valid exchange is logged (`mock/tools/<tool>/<name> skipped`, the
 * reason as the error) and left out; a missing folder is no recordings. Only the tool's own folder is read.
 */
export async function readToolRecordings(dir: string, tool: string, log: (message: string, err?: unknown) => void): Promise<FixtureExchange[]> {
  if (!TOOL_ID.test(tool)) throw new Error(`"${tool.slice(0, 64)}" is not a tool id`);
  if (!(await isDir(dir))) return [];
  const files = await readFixtureFiles(path.join(dir, tool), parseFixture, (name, err) => log(`mock/tools/${tool}/${name} skipped`, err));
  return files.map((f) => f.value);
}
