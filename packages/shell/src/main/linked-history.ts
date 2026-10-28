import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** How long an unlinked folder's core history is kept (hatches spec §3.2). */
export const LINKED_KEEP_DAYS = 30;
const MARK = "unlinked-at";
const NAME = /^[0-9a-f]{16}$/;

/** The gitdir of a tracked linked folder's history: one per real path, in the app's data folder (Decision 5). */
export function linkedHistoryDir(userData: string, realPath: string): string {
  return path.join(userData, "linked-history", createHash("sha256").update(realPath).digest("hex").slice(0, 16));
}

/** Marks a history as unlinked at `now`; a folder that never had a history (no dir) is left without one. */
export async function markUnlinked(dir: string, now: Date): Promise<void> {
  await fs.writeFile(path.join(dir, MARK), now.toISOString()).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });
}

/** A relink of the same path continues its history: the unlink mark goes. */
export async function markRelinked(dir: string): Promise<void> {
  await fs.rm(path.join(dir, MARK), { force: true });
}

/** Moves histories unlinked more than 30 days ago to the system Trash (`trash`); a failure is logged and kept. */
export async function pruneUnlinked(userData: string, now: Date, trash: (dir: string) => Promise<void>): Promise<void> {
  const base = path.join(userData, "linked-history");
  const names = await fs.readdir(base).catch(() => [] as string[]);
  for (const name of names) {
    if (!NAME.test(name)) continue;
    const dir = path.join(base, name);
    const text = await fs.readFile(path.join(dir, MARK), "utf8").catch(() => null);
    if (text === null) continue; // still linked
    const at = Date.parse(text);
    if (!Number.isFinite(at)) {
      console.error(`A linked history's unlink mark isn't a date: ${dir}`);
      continue;
    }
    if (now.getTime() - at > LINKED_KEEP_DAYS * 86_400_000) {
      await trash(dir).catch((err: unknown) => console.error(`Could not move an old linked history to the Trash: ${dir}`, err));
    }
  }
}
