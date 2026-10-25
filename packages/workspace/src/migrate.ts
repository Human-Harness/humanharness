import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { MAIN_SCOPE, NOTES_PREFIX, chatFile, dataDir } from "./layout";
import { ScopeStore } from "./scopes";

/** The title of the scope that receives a folder's earlier work. */
export const MIGRATED_TITLE = "General";

/**
 * The first start of a harness that declares scopes, in a folder used without them (spec §3.2): the flat notes
 * move into `notes/main/` and `main` is registered, so nothing is lost. The chat needs no move (`main.jsonl` is
 * `main`'s chat), nor do the statuses (`tasks.json` `actions` are `main`'s) or the data (a harness without scopes
 * already keeps its scoped collections in `data/main/`). The registry is written last: it marks the migration done,
 * and a crash before it leaves the migration to run again. False when there was nothing to do (registry already
 * there, or no earlier notes, chat or data in `main`). `store` is the base's registry: pass the one the app writes
 * through, so `main` is added in the same queue as the person's own changes.
 */
export async function migrateToScopes(
  base: string,
  now: () => Date = () => new Date(),
  store: ScopeStore = new ScopeStore(base, now),
): Promise<boolean> {
  if (await store.exists()) return false;
  const dir = path.join(base, NOTES_PREFIX);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const flat = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  const hasMain = entries.some((e) => e.isDirectory() && e.name === MAIN_SCOPE);
  const hasChat = await fs.access(chatFile(base, MAIN_SCOPE)).then(
    () => true,
    () => false,
  );
  const hasData = (await fs.readdir(dataDir(base, MAIN_SCOPE)).catch(() => [])).length > 0;
  if (flat.length === 0 && !hasChat && !hasMain && !hasData) return false;
  const target = path.join(dir, MAIN_SCOPE);
  await fs.mkdir(target, { recursive: true });
  for (const name of flat) await moveIfFree(path.join(dir, name), path.join(target, name));
  await store.add({ id: MAIN_SCOPE, title: MIGRATED_TITLE, createdAt: now().toISOString(), archived: false });
  return true;
}

/**
 * Moves `from` to `to` unless `to` exists (the note already in `main` wins) or `from` is gone (another window moved it).
 * A hard link never overwrites; where the filesystem has none (exFAT, some network or FUSE drives) an exclusive copy does the same.
 */
async function moveIfFree(from: string, to: string): Promise<void> {
  try {
    try {
      await fs.link(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOTSUP" && code !== "EPERM" && code !== "ENOSYS" && code !== "EMLINK") throw e;
      await fs.copyFile(from, to, constants.COPYFILE_EXCL);
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") return;
    throw e;
  }
  await fs.unlink(from).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
}
