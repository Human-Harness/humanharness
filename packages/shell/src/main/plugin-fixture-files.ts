import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { type FixtureExchange, parseFixture } from "@humanharness/harness-sdk/plugin-fixtures";

/** At most this many fixture files per source are read (P10, Decision 14). */
export const FIXTURE_FILES = 200;
/** A fixture file over this many bytes is skipped unread. */
export const FIXTURE_BYTES = 10 * 1024 * 1024;

/**
 * `<fixtures>/<source>/*.json` in file-name order (Decision 14): at most FIXTURE_FILES files of at most FIXTURE_BYTES.
 * A plugin's folder is hostile: links are not followed (the `fixtures/` and `<source>/` folders, a file, or a hard link,
 * which is a second name for a file anywhere on the disk), and a file that isn't a valid exchange is logged
 * (`fixtures/<source>/<name> skipped`, with the reason as the error) and skipped. A missing folder is no fixtures.
 * The app's fixture mode and the CLI's `plugin test` read fixtures with this one function.
 */
export async function readPluginFixtures(dir: string, source: string, log: (message: string, err?: unknown) => void): Promise<FixtureExchange[]> {
  const folder = path.join(dir, source);
  const isDir = async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;
  if (!(await isDir(dir)) || !(await isDir(folder))) return [];
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
      if (st.nlink > 1) throw new Error("a hard link");
      if (st.size > FIXTURE_BYTES) throw new Error("larger than 10 MB");
      out.push(parseFixture(JSON.parse(await file.readFile("utf8"))));
    } catch (err) {
      log(`fixtures/${source}/${name} skipped`, err);
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
  return out;
}
