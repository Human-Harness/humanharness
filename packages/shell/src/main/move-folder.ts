import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FolderProblem, MoveError } from "@humanharness/ui/client";
import { relativizeNoteFiles } from "@humanharness/workspace";

/** A move that failed with the reason the window shows. The old folder is untouched and still the app's folder. */
export class MoveFailed extends Error {
  constructor(
    readonly code: MoveError,
    cause?: unknown,
  ) {
    super(`The folder could not be moved: ${code}`, { cause });
  }
}

/** The file operations a move uses (tests make each one fail). */
export interface MoveOps {
  cp: typeof fs.cp;
  rm: typeof fs.rm;
  rename: typeof fs.rename;
  /** Free bytes on the disk that holds `dir`; null when unknown. */
  freeBytes(dir: string): Promise<number | null>;
}

const realOps: MoveOps = {
  cp: (...args) => fs.cp(...args),
  rm: (...args) => fs.rm(...args),
  rename: (...args) => fs.rename(...args),
  freeBytes: async (dir) => {
    try {
      const s = await fs.statfs(dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  },
};

export interface MoveDeps {
  /** Why the new place can't be the folder (`checkFolder`, as at first launch); null when it can. */
  check(folder: string): Promise<FolderProblem | null>;
  /** The files the history tracks, relative to the folder: their bytes are compared after the copy. */
  tracked(): Promise<string[]>;
  /** Saves `folder` as the app's folder (`ConfigStore.replaceFolder`). */
  saveFolder(folder: string): Promise<void>;
  /** Where the hidden history of a folder lives (`historyDir`). */
  historyDir(folder: string): string;
  ops?: Partial<MoveOps>;
  now?: () => number;
}

export interface MoveDone {
  /** False when the old folder could not be removed; the move itself succeeded. */
  oldRemoved: boolean;
}

// macOS file systems are usually case-insensitive and keep names as typed (NFC or NFD): compare without either.
const key = (p: string) => p.normalize("NFC").toLowerCase();
const isInside = (child: string, parent: string) => {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(p + path.sep);
};
const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** The reason the window shows for a failed file operation. */
export function failureOf(err: unknown, fallback: MoveError = "failed"): MoveError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return "no-space";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "no-permission";
  if (code === "EEXIST" || code === "ERR_FS_CP_EEXIST") return "exists";
  return fallback;
}

interface Item {
  size: number;
  /** A link's target; null for a file. */
  link: string | null;
}

/** Every file and link under `dir`, by relative path (Finder's `.DS_Store` files left out). */
async function listing(dir: string): Promise<Map<string, Item>> {
  const out = new Map<string, Item>();
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const child = rel ? path.join(rel, entry.name) : entry.name;
      const full = path.join(dir, child);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isSymbolicLink()) out.set(child, { size: 0, link: await fs.readlink(full) });
      else out.set(child, { size: (await fs.stat(full)).size, link: null });
    }
  };
  await walk("");
  return out;
}

const hash = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");

/** Same relative files with the same sizes (and links with the same targets), and the same bytes for the tracked files. */
export async function sameContents(from: string, to: string, tracked: string[]): Promise<boolean> {
  const [a, b] = await Promise.all([listing(from), listing(to)]);
  if (a.size !== b.size) return false;
  for (const [rel, item] of a) {
    const other = b.get(rel);
    if (!other || other.size !== item.size || other.link !== item.link) return false;
  }
  for (const rel of tracked) {
    // Only plain files: a tracked path that is a link is compared by its target above.
    if (a.get(path.normalize(rel))?.link !== null) continue;
    if ((await hash(path.join(from, rel))) !== (await hash(path.join(to, rel)))) return false;
  }
  return true;
}

async function nearestExisting(dir: string): Promise<string> {
  let d = dir;
  while (!(await exists(d)) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

/**
 * Moves the person's folder to `to` with its history (spec 3d §2): refuse, copy, verify, save the config,
 * move the history, remove the old folder. A failure before the last step undoes what was done, so `from`
 * stays as it was and stays the app's folder. A failure removing `from` leaves the move done.
 * The caller refuses it while a turn or a restore runs and holds both off meanwhile.
 */
export async function moveFolder(from: string, to: string, d: MoveDeps): Promise<MoveDone> {
  const ops: MoveOps = { ...realOps, ...d.ops };
  const source = path.resolve(from);
  const target = path.resolve(to);
  const removeCopy = (): Promise<void> =>
    ops.rm(target, { recursive: true, force: true }).catch((err: unknown) => console.error("Could not remove the copy", err));

  // 1. Refusals: nothing has been touched yet.
  if (isInside(target, source) || isInside(source, target)) throw new MoveFailed("inside");
  if (await exists(target)) throw new MoveFailed("exists");
  if (await d.check(target)) throw new MoveFailed("unsuitable");
  const need = [...(await listing(source)).values()].reduce((n, item) => n + item.size, 0);
  const free = await ops.freeBytes(await nearestExisting(path.dirname(target)));
  if (free !== null && free < need) throw new MoveFailed("no-space");

  // 2. Copy, keeping timestamps; links stay links.
  try {
    await ops.cp(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  } catch (err) {
    const reason = failureOf(err);
    // Something else created the place meanwhile: it isn't ours to remove.
    if (reason !== "exists") await removeCopy();
    throw new MoveFailed(reason, err);
  }

  // 3. Verify; then the notes stop naming the old place.
  try {
    if (!(await sameContents(source, target, await d.tracked()))) throw new MoveFailed("mismatch");
    await relativizeNoteFiles(target, source);
  } catch (err) {
    await removeCopy();
    throw err instanceof MoveFailed ? err : new MoveFailed(failureOf(err, "mismatch"), err);
  }

  // 4. The app's folder.
  try {
    await d.saveFolder(target);
  } catch (err) {
    await removeCopy();
    throw new MoveFailed("failed", err);
  }

  // 5. The history follows the folder; a stale history of the new place is set aside.
  const oldHistory = d.historyDir(source);
  const newHistory = d.historyDir(target);
  let setAside: string | null = null;
  try {
    if (await exists(oldHistory)) {
      if (await exists(newHistory)) {
        setAside = `${newHistory}.replaced-${(d.now ?? Date.now)()}`;
        await ops.rename(newHistory, setAside);
      }
      await ops.rename(oldHistory, newHistory);
    }
  } catch (err) {
    if (setAside) await ops.rename(setAside, newHistory).catch((e: unknown) => console.error("Could not put the old history back", e));
    const restored = await d.saveFolder(source).then(
      () => true,
      (e: unknown) => {
        console.error("Could not put the folder back in the config", e);
        return false;
      },
    );
    // The config still names the copy: keep it, so the person never loses their folder.
    if (restored) await removeCopy();
    throw new MoveFailed("failed", err);
  }

  // 6. The old folder. The move is done even when this fails.
  try {
    await ops.rm(source, { recursive: true, force: true });
    return { oldRemoved: true };
  } catch (err) {
    console.error("Could not remove the old folder", err);
    return { oldRemoved: false };
  }
}

export interface GuardedMoveDeps {
  /** Holds turns (and so restores, which check them) off while the folder changes (EngineGuards). */
  guards: { beginFolderChange(isBusy: () => boolean): void; endFolderChange(): void; turnBlocked(): string | null };
  /** A turn, a task operation or a restore is under way. */
  isBusy(): boolean;
  /**
   * Before turns are held: the open task saves a checkpoint note, since the move ends its session
   * (TaskManager.checkpointBeforeMove). A failure is logged and the move goes on.
   */
  checkpoint?(): Promise<void>;
  /** Waits for the chat log and history writes of the last turn. */
  flush(): Promise<void>;
  /** Closes the runtime, which works on the old folder, without ending the open task. */
  closeRuntime(): Promise<void>;
  /** Settles once the last restore has finished. */
  restoresSettled(): Promise<unknown>;
  /** The runtime was closed: the open task's next follow-up starts a new session from its notes. */
  resumeFromNotes(): Promise<void>;
  /** The move itself (moveFolder). */
  move(): Promise<MoveDone>;
}

/**
 * A move against turns and restores (spec 3d §2): refused while either runs, and both held off from its
 * first moment until it ends. The open task's checkpoint runs first, as a turn of its own; then the busy
 * check and the hold happen synchronously, so a send or a restore can't slip in between (one that started
 * meanwhile refuses the move). The answer is data: a failure is a reason, never a thrown error.
 */
export async function guardedMove(d: GuardedMoveDeps): Promise<{ ok: true; done: MoveDone } | { ok: false; error: MoveError }> {
  if (d.isBusy() || d.guards.turnBlocked()) return { ok: false, error: "busy" };
  if (d.checkpoint) {
    try {
      await d.checkpoint();
    } catch (err) {
      console.error("Could not save a checkpoint before the move; the open task resumes from the notes there are", err);
    }
  }
  try {
    d.guards.beginFolderChange(() => d.isBusy());
  } catch {
    return { ok: false, error: "busy" };
  }
  let closing = false;
  try {
    await d.flush();
    // The runtime works on the old folder. The open task stays open and continues from its notes.
    closing = true;
    await d.closeRuntime();
    await d.restoresSettled();
    return { ok: true, done: await d.move() };
  } catch (err) {
    if (err instanceof MoveFailed) return { ok: false, error: err.code };
    console.error("Could not move the folder", err);
    return { ok: false, error: "failed" };
  } finally {
    // Once the runtime is closed the engine session is gone, whether or not the move went through.
    if (closing) await d.resumeFromNotes().catch((err: unknown) => console.error("Could not keep the open task", err));
    d.guards.endFolderChange();
  }
}
