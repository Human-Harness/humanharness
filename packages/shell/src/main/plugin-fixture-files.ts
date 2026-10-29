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
  if (!(await isDir(dir))) return [];
  const files = await readFixtureFiles(path.join(dir, source), parseFixture, (name, err) => log(`fixtures/${source}/${name} skipped`, err));
  return files.map((f) => f.value);
}

const isDir = async (p: string) => (await fs.lstat(p).catch(() => null))?.isDirectory() === true;

/**
 * `<folder>/*.json` in file-name order, with the rules above: the folder itself is not a link (else none), at most
 * FIXTURE_FILES files of at most FIXTURE_BYTES, no file link or hard link, and a file `parse` refuses is passed to
 * `skipped` with its name and the reason, and left out. Plugin fixtures and tool fixtures (`tools/<id>/fixtures/`).
 */
export async function readFixtureFiles<T>(folder: string, parse: (raw: unknown) => T, skipped: (name: string, err: unknown) => void): Promise<{ file: string; value: T }[]> {
  if (!(await isDir(folder))) return [];
  const names = (await fs.readdir(folder, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => d.name)
    .sort()
    .slice(0, FIXTURE_FILES);
  const out: { file: string; value: T }[] = [];
  for (const name of names) {
    let file: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      file = await fs.open(path.join(folder, name), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const st = await file.stat();
      if (!st.isFile()) throw new Error("not a file");
      if (st.nlink > 1) throw new Error("a hard link");
      if (st.size > FIXTURE_BYTES) throw new Error("larger than 10 MB");
      out.push({ file: name, value: parse(JSON.parse(await file.readFile("utf8"))) });
    } catch (err) {
      skipped(name, err);
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
  return out;
}
