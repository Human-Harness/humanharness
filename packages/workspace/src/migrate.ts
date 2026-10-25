import { promises as fs } from "node:fs";
import path from "node:path";
import { MAIN_SCOPE, NOTES_PREFIX, chatFile } from "./layout";
import { ScopeStore } from "./scopes";

/** The title of the scope that receives a folder's earlier work. */
export const MIGRATED_TITLE = "General";

/**
 * The first start of a harness that declares scopes, in a folder used without them (spec §3.2): the flat notes
 * move into `notes/main/` and `main` is registered, so nothing is lost. The chat needs no move (`main.jsonl` is
 * `main`'s chat) and neither do the statuses (`tasks.json` `actions` are `main`'s). The registry is written last:
 * it marks the migration done, and a crash before it leaves the migration to run again. False when there was
 * nothing to do (registry already there, or no earlier notes or chat).
 */
export async function migrateToScopes(base: string, now: () => Date = () => new Date()): Promise<boolean> {
  const store = new ScopeStore(base, now);
  if (await store.exists()) return false;
  const dir = path.join(base, NOTES_PREFIX);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const flat = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  const hasMain = entries.some((e) => e.isDirectory() && e.name === MAIN_SCOPE);
  const hasChat = await fs.access(chatFile(base, MAIN_SCOPE)).then(
    () => true,
    () => false,
  );
  if (flat.length === 0 && !hasChat && !hasMain) return false;
  const target = path.join(dir, MAIN_SCOPE);
  await fs.mkdir(target, { recursive: true });
  for (const name of flat) await moveIfFree(path.join(dir, name), path.join(target, name));
  await store.add({ id: MAIN_SCOPE, title: MIGRATED_TITLE, createdAt: now().toISOString(), archived: false });
  return true;
}

/** Moves `from` to `to` unless `to` exists (the note already in `main` wins) or `from` is gone (another window moved it). */
async function moveIfFree(from: string, to: string): Promise<void> {
  try {
    await fs.link(from, to);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") return;
    throw e;
  }
  await fs.unlink(from).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
}
