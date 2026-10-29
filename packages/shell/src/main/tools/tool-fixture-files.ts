import { promises as fs } from "node:fs";
import path from "node:path";
import { TOOL_ID } from "@humanharness/harness-sdk";
import { type ToolFixture, toolFixtureSchema } from "@humanharness/harness-sdk/tool-fixtures";
import { readFixtureFiles } from "../plugin-fixture-files";

const isDir = async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;

/**
 * `<root>/tools/<tool>/fixtures/*.json` in file-name order, each with its file name (tools spec §11, A4): the plugin
 * fixture files' rules (count and size caps, no links: `tools/`, `tools/<tool>/` and `fixtures/` must be real folders),
 * and a file that isn't a valid case is logged (`tools/<tool>/fixtures/<name> skipped`, the reason as the error) and
 * skipped. A missing folder is no fixtures. `humanharness tool test` and `check` read fixtures with this one function.
 */
export async function readToolFixtures(root: string, tool: string, log: (message: string, err?: unknown) => void): Promise<{ file: string; fixture: ToolFixture }[]> {
  if (!TOOL_ID.test(tool)) throw new Error(`"${tool.slice(0, 64)}" is not a tool id`);
  const toolDir = path.join(root, "tools", tool);
  if (!(await isDir(path.dirname(toolDir))) || !(await isDir(toolDir))) return [];
  const files = await readFixtureFiles(path.join(toolDir, "fixtures"), (raw) => toolFixtureSchema.parse(raw), (name, err) => log(`tools/${tool}/fixtures/${name} skipped`, err));
  return files.map(({ file, value }) => ({ file, fixture: value }));
}
