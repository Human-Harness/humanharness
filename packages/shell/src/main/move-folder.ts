import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
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

/** The file operations a move uses (tests make each one fail or stop). */
export interface MoveOps {
  cp: typeof fs.cp;
  rm: typeof fs.rm;
  rename: typeof fs.rename;
  mkdir: typeof fs.mkdir;
  /** Free bytes on the disk that holds `dir`; null when unknown. */
  freeBytes(dir: string): Promise<number | null>;
  /** Puts a file or folder in the system Trash (Electron's `shell.trashItem`; the main process passes it). */
  trash(p: string): Promise<void>;
  /** The SHA-256 of a file's bytes (`hashFile`). */
  hash(file: string): Promise<string>;
}

/** The SHA-256 of a file, read as a stream so a large file never sits in memory whole. */
export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => h.update(chunk))
      .on("end", () => resolve(h.digest("hex")));
  });
}

const realOps: MoveOps = {
  cp: (...args) => fs.cp(...args),
  rm: (...args) => fs.rm(...args),
  rename: (...args) => fs.rename(...args),
  mkdir: ((...args: Parameters<typeof fs.mkdir>) => fs.mkdir(...args)) as typeof fs.mkdir,
  freeBytes: async (dir) => {
    try {
      const s = await fs.statfs(dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  },
  // Never a permanent delete in its place: without a Trash the old folder stays where it is.
  trash: async () => Promise.reject(new Error("No Trash to put the old folder in")),
  hash: hashFile,
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
  /** The move journal in the app's data folder (`moveJournal`): `recoverMove` finishes or undoes a move cut short. */
  journal: string;
  ops?: Partial<MoveOps>;
  now?: () => number;
}

export interface MoveDone {
  /** False when the old folder was kept: it changed after the copy, or it couldn't go to the Trash. */
  oldRemoved: boolean;
  /**
   * False when the history couldn't follow and the config couldn't be put back either: the copy is the
   * app's folder now, the old folder is kept, and the next start moves the history (the journal stays).
   */
  historyMoved: boolean;
}

/** How far a move got: written to the journal before each step, so a start after a crash knows what is whose. */
export type MoveStage = "copying" | "renaming" | "copied" | "config-saved" | "history-moved";

export interface MoveJournal {
  from: string;
  to: string;
  /**
   * The temporary place next to `to` (`<to>.hh-moving-<random>`), made by this move; the copy is made inside
   * it under the folder's own name (`copyIn`), so the copy starts in a folder nobody else had.
   */
  temp: string;
  stage: MoveStage;
  /** Where a stale history of `to` was set aside. */
  setAside?: string;
}

/** Where the move journal lives in the app's data folder. */
export const moveJournal = (userData: string) => path.join(userData, "move-journal.json");

/** Histories set aside by a move are kept this long, then pruned. */
export const REPLACED_KEEP_MS = 30 * 24 * 60 * 60_000;
/** Free space kept beyond the folder's size: 5 %, and at least 100 MB. */
const headroom = (bytes: number) => Math.max(bytes * 0.05, 100 * 1024 * 1024);
const TEMP_MARK = ".hh-moving-";
/** Where the copy is made inside the temporary place. */
const copyIn = (temp: string, to: string) => path.join(temp, path.basename(to));

// macOS file systems are usually case-insensitive and keep names as typed (NFC or NFD): compare without either.
const key = (p: string) => p.normalize("NFC").toLowerCase();
const isInside = (child: string, parent: string) => {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(p + path.sep);
};
const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** `p` with links resolved, for the part of it that exists (the rest is appended as written). */
async function realOf(p: string): Promise<string> {
  const rest: string[] = [];
  let d = p;
  while (!(await exists(d)) && path.dirname(d) !== d) {
    rest.unshift(path.basename(d));
    d = path.dirname(d);
  }
  return path.join(await fs.realpath(d).catch(() => d), ...rest);
}

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
  mtime: number;
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
      else {
        const s = await fs.lstat(full);
        out.set(child, { size: s.size, mtime: s.mtimeMs, link: entry.isSymbolicLink() ? await fs.readlink(full) : null });
      }
    }
  };
  await walk("");
  return out;
}

/** Same relative files, sizes, times and link targets: nothing was written since `before` was taken. */
function unchanged(before: Map<string, Item>, after: Map<string, Item>): boolean {
  if (before.size !== after.size) return false;
  for (const [rel, a] of before) {
    const b = after.get(rel);
    if (!b || b.size !== a.size || b.mtime !== a.mtime || b.link !== a.link) return false;
  }
  return true;
}

/**
 * Same relative files with the same sizes (and links with the same targets), and the same bytes for the
 * tracked files. A tracked file that can't be read rejects (a failure, not a mismatch).
 */
export async function sameContents(from: string, to: string, tracked: string[], hash: (file: string) => Promise<string> = hashFile): Promise<boolean> {
  const [a, b] = await Promise.all([listing(from), listing(to)]);
  if (a.size !== b.size) return false;
  for (const [rel, item] of a) {
    const other = b.get(rel);
    if (!other || other.size !== item.size || other.link !== item.link) return false;
  }
  for (const rel of tracked) {
    // A tracked path that is a link is compared by its target above. One the listing names differently
    // (NFC in the history, NFD on disk) is hashed directly.
    if (a.get(path.normalize(rel))?.link) continue;
    if ((await hash(path.join(from, rel))) !== (await hash(path.join(to, rel)))) return false;
  }
  return true;
}

async function nearestExisting(dir: string): Promise<string> {
  let d = dir;
  while (!(await exists(d)) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

/** Removes the histories a move set aside (`<history>.replaced-<ms>`) once they are older than `keepMs`. */
export async function pruneReplaced(historyRoot: string, now: number, keepMs = REPLACED_KEEP_MS): Promise<void> {
  const names = await fs.readdir(historyRoot).catch(() => [] as string[]);
  for (const name of names) {
    const at = /\.replaced-(\d+)$/.exec(name);
    if (!at || now - Number(at[1]) <= keepMs) continue;
    await fs.rm(path.join(historyRoot, name), { recursive: true, force: true }).catch((err: unknown) => console.error("Could not prune an old history", err));
  }
}

async function writeJournal(file: string, j: MoveJournal): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(j, null, 2));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

const clearJournal = (file: string) => fs.rm(file, { force: true }).catch((err: unknown) => console.error("Could not clear the move journal", err));

/** The folder's listing, taken by the refusals: what is copied, and what the old folder must still be before it goes. */
export interface Checked {
  source: string;
  target: string;
  before: Map<string, Item>;
}

/**
 * The refusals of a move, touching nothing (spec 3d §2): a place inside the folder or containing it (also
 * through links), a folder that is a link, a place that exists or `checkFolder` refuses, too little space.
 * Cheap: `guardedMove` runs them before the checkpoint turn, and `moveFolder` again.
 */
export async function precheckMove(from: string, to: string, d: Pick<MoveDeps, "check" | "journal" | "ops">): Promise<Checked> {
  const ops: MoveOps = { ...realOps, ...d.ops };
  const source = path.resolve(from);
  const target = path.resolve(to);
  if (isInside(target, source) || isInside(source, target)) throw new MoveFailed("inside");
  // An earlier move cut short is settled at the next start; until then nothing moves.
  if (await exists(d.journal)) throw new MoveFailed("failed");
  // The folder itself a link: moving it would move what it points to and leave the link.
  const stat = await fs.lstat(source).catch(() => null);
  if (!stat?.isDirectory()) throw new MoveFailed("failed");
  const [realSource, realTarget] = await Promise.all([realOf(source), realOf(target)]);
  if (isInside(realTarget, realSource) || isInside(realSource, realTarget)) throw new MoveFailed("inside");
  if (await exists(target)) throw new MoveFailed("exists");
  if (await d.check(target)) throw new MoveFailed("unsuitable");
  const before = await listing(source).catch((err: unknown) => {
    throw new MoveFailed("failed", err);
  });
  const need = [...before.values()].reduce((n, item) => n + item.size, 0);
  const free = await ops.freeBytes(await nearestExisting(path.dirname(target)));
  if (free !== null && free < need + headroom(need)) throw new MoveFailed("no-space");
  return { source, target, before };
}

/**
 * Moves the person's folder to `to` with its history (spec 3d §2): refuse; copy into a temporary place next
 * to `to` and verify it there; rename it to `to`; save the config; move the history; put the old folder in
 * the Trash. A failure before the history has moved undoes what was done (removing only what this move
 * made), so `from` stays as it was and stays the app's folder. Each step is written to the journal first, so
 * a quit or crash on the way is finished or undone at the next start (`recoverMove`). The old folder is kept
 * when anything in it changed after the copy, or when it can't go to the Trash.
 * The caller refuses it while a turn or a restore runs and holds both off meanwhile.
 */
export async function moveFolder(from: string, to: string, d: MoveDeps): Promise<MoveDone> {
  const ops: MoveOps = { ...realOps, ...d.ops };
  const now = d.now ?? Date.now;
  const { source, target, before } = await precheckMove(from, to, d);
  const temp = `${target}${TEMP_MARK}${randomBytes(6).toString("hex")}`;
  const copy = copyIn(temp, target);
  const journal: MoveJournal = { from: source, to: target, temp, stage: "copying" };
  const step = async (stage: MoveStage, extra: Partial<MoveJournal> = {}) => writeJournal(d.journal, Object.assign(journal, { stage }, extra));

  try {
    await step("copying");
  } catch (err) {
    throw new MoveFailed("failed", err);
  }

  // The parent folders this move creates, deepest first: removed again (when empty) if it fails.
  const created: string[] = [];
  const removeParents = async () => {
    for (const dir of created) await fs.rmdir(dir).catch(() => undefined);
  };
  const removeTemp = () => ops.rm(temp, { recursive: true, force: true }).catch((err: unknown) => console.error("Could not remove the temporary copy", err));
  /** Undoes a failure before the copy is in place: only the temporary copy and the parents are ours. */
  const abandon = async (err: MoveFailed): Promise<never> => {
    await removeTemp();
    await removeParents();
    await clearJournal(d.journal);
    throw err;
  };

  // 2. Copy into a temporary place made here (never an existing one), keeping timestamps; links stay links.
  try {
    const parent = path.dirname(target);
    const first = await ops.mkdir(parent, { recursive: true });
    if (first) for (let dir = parent; ; dir = path.dirname(dir)) {
      created.push(dir);
      if (dir === first || path.dirname(dir) === dir) break;
    }
    await ops.mkdir(temp);
  } catch (err) {
    // The temporary place exists already: not ours, so it is left alone.
    await removeParents();
    await clearJournal(d.journal);
    throw new MoveFailed(failureOf(err) === "exists" ? "failed" : failureOf(err), err);
  }
  try {
    await ops.cp(source, copy, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  } catch (err) {
    // Inside the temporary copy a clash is two names the disk takes as one (case, NFC/NFD), not a place that exists.
    const reason = failureOf(err);
    return abandon(new MoveFailed(reason === "exists" ? "failed" : reason, err));
  }

  // 3. Verify in the temporary place; then the notes stop naming the old place.
  try {
    if (!(await sameContents(source, copy, await d.tracked(), ops.hash))) return await abandon(new MoveFailed("mismatch"));
    await relativizeNoteFiles(copy, source);
  } catch (err) {
    if (err instanceof MoveFailed) throw err;
    return abandon(new MoveFailed("failed", err));
  }

  // The copy goes in place, unless something else took the place meanwhile.
  if (await exists(target)) return abandon(new MoveFailed("exists"));
  try {
    await step("renaming");
    await ops.rename(copy, target);
    await step("copied");
    await fs.rmdir(temp).catch((err: unknown) => console.error("Could not remove the temporary place", err));
  } catch (err) {
    // Either the rename didn't happen (the temporary copy is still there) or the copy is at `target`.
    if (!(await exists(copy)) && (await exists(target))) await ops.rm(target, { recursive: true, force: true }).catch(() => undefined);
    return abandon(new MoveFailed(failureOf(err) === "exists" ? "failed" : failureOf(err), err));
  }

  const removeCopy = async () => {
    await ops.rm(target, { recursive: true, force: true }).catch((err: unknown) => console.error("Could not remove the copy", err));
    await removeParents();
    await clearJournal(d.journal);
  };

  // 4. The app's folder.
  try {
    await d.saveFolder(target);
  } catch (err) {
    await removeCopy();
    throw new MoveFailed("failed", err);
  }

  // 5. The history follows the folder; a history the new place already had is set aside.
  const oldHistory = d.historyDir(source);
  const newHistory = d.historyDir(target);
  let setAside: string | null = null;
  let historyRenamed = false;
  try {
    const stale = await exists(newHistory);
    if (stale) setAside = `${newHistory}.replaced-${now()}`;
    await step("config-saved", setAside ? { setAside } : {});
    if (setAside) await ops.rename(newHistory, setAside);
    if (await exists(oldHistory)) {
      await ops.rename(oldHistory, newHistory);
      historyRenamed = true;
    }
    await step("history-moved");
  } catch (err) {
    const restored = await d.saveFolder(source).then(
      () => true,
      (e: unknown) => {
        console.error("Could not put the folder back in the config", e);
        return false;
      },
    );
    if (restored) {
      // The history moved but the journal couldn't say so: it goes back first, so it isn't left under the copy.
      if (historyRenamed && !(await exists(oldHistory))) {
        await ops.rename(newHistory, oldHistory).catch((e: unknown) => console.error("Could not put the history back", e));
      }
      if (setAside && (await exists(setAside)) && !(await exists(newHistory))) {
        await ops.rename(setAside, newHistory).catch((e: unknown) => console.error("Could not put the old history back", e));
      }
      await removeCopy();
      throw new MoveFailed("failed", err);
    }
    // The config still names the copy: it stays the folder and the old one is kept. The journal stays,
    // so the next start moves the history after it (when it didn't get there already).
    if (historyRenamed) {
      console.error("The move couldn't be recorded; the folder and its history are at the new place", err);
      return { oldRemoved: false, historyMoved: true };
    }
    console.error("The folder moved without its history; the next start moves it", err);
    return { oldRemoved: false, historyMoved: false };
  }
  await pruneReplaced(path.dirname(newHistory), now());

  // 6. The old folder goes to the Trash, only if nothing in it changed since the copy. The move is done either way.
  try {
    if (!unchanged(before, await listing(source))) {
      console.error("The old folder changed after the copy; it is kept");
      return { oldRemoved: false, historyMoved: true };
    }
    await ops.trash(source);
    return { oldRemoved: true, historyMoved: true };
  } catch (err) {
    console.error("Could not put the old folder in the Trash", err);
    return { oldRemoved: false, historyMoved: true };
  } finally {
    await clearJournal(d.journal);
  }
}

export interface RecoverDeps {
  journal: string;
  /** The folder the config names now: the truth the history is made to follow. */
  currentFolder(): Promise<string | undefined>;
  historyDir(folder: string): string;
  ops?: Partial<MoveOps>;
  now?: () => number;
}

/**
 * At startup, settles a move a quit or crash cut short, from its journal. The config decides: when it names
 * the new place the history is moved after it; when it names the old place the copy this move made (and its
 * temporary copy) is removed and the history is put back. The old folder is never removed here: the answer
 * names it (`leftBehind`) when the move went through. Null when there was no journal (or it couldn't be read).
 */
export async function recoverMove(d: RecoverDeps): Promise<{ folder: string; leftBehind?: string } | null> {
  const ops: MoveOps = { ...realOps, ...d.ops };
  let j: MoveJournal;
  try {
    j = JSON.parse(await fs.readFile(d.journal, "utf8")) as MoveJournal;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error("Could not read the move journal; nothing was touched", err);
    await clearJournal(d.journal);
    return null;
  }
  const stages: MoveStage[] = ["copying", "renaming", "copied", "config-saved", "history-moved"];
  if (
    typeof j?.from !== "string" ||
    typeof j.to !== "string" ||
    typeof j.temp !== "string" ||
    !j.temp.startsWith(`${j.to}${TEMP_MARK}`) ||
    path.dirname(j.temp) !== path.dirname(j.to) ||
    !stages.includes(j.stage)
  ) {
    console.error("The move journal makes no sense; nothing was touched");
    await clearJournal(d.journal);
    return null;
  }

  // The temporary copy the journal names is ours; any other `*.hh-moving-*` is left alone.
  const copyLeft = await exists(copyIn(j.temp, j.to));
  if (await exists(j.temp)) await ops.rm(j.temp, { recursive: true, force: true }).catch((err: unknown) => console.error("Could not remove the temporary copy", err));
  // `to` is ours once the copy was renamed there (it is gone from the temporary place by then).
  const toIsOurs = j.stage !== "copying" && !copyLeft;
  const folder = await d.currentFolder();
  const oldHistory = d.historyDir(j.from);
  const newHistory = d.historyDir(j.to);
  try {
    if (folder === j.to) {
      if (await exists(oldHistory)) {
        if (await exists(newHistory)) await ops.rename(newHistory, `${newHistory}.replaced-${(d.now ?? Date.now)()}`);
        await ops.rename(oldHistory, newHistory);
      }
      await pruneReplaced(path.dirname(newHistory), (d.now ?? Date.now)());
      await clearJournal(d.journal);
      return { folder, ...((await exists(j.from)) ? { leftBehind: j.from } : {}) };
    }
    if (folder === j.from) {
      if (j.stage === "history-moved" && !(await exists(oldHistory)) && (await exists(newHistory))) await ops.rename(newHistory, oldHistory);
      if (j.setAside && (await exists(j.setAside)) && !(await exists(newHistory))) await ops.rename(j.setAside, newHistory);
      // The copy goes only while the old folder is still there.
      if (toIsOurs && (await exists(j.to)) && (await exists(j.from))) await ops.rm(j.to, { recursive: true, force: true });
      await clearJournal(d.journal);
      return { folder };
    }
  } catch (err) {
    // The journal stays: the next start tries again.
    console.error("Could not settle the interrupted move", err);
    return folder ? { folder } : null;
  }
  console.error("The config names neither place of the interrupted move; nothing was touched");
  await clearJournal(d.journal);
  return folder ? { folder } : null;
}

export interface GuardedMoveDeps {
  /** The refusals of the move that touch nothing (`precheckMove`): run before the checkpoint turn, so a bad place costs no turn. */
  precheck?(): Promise<unknown>;
  /** The app started quitting: a move not yet begun doesn't start. */
  quitting?(): boolean;
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
 * first moment until it ends. The new place is checked first (no turn is spent on a place that is refused);
 * then the open task's checkpoint runs, as a turn of its own; then, unless the app started quitting or an
 * engine update or sign-out started, the busy check and the hold happen synchronously, so a send or a restore can't slip in between (one that started
 * meanwhile refuses the move). The answer is data: a failure is a reason, never a thrown error.
 */
export async function guardedMove(d: GuardedMoveDeps): Promise<{ ok: true; done: MoveDone } | { ok: false; error: MoveError }> {
  if (d.isBusy() || d.guards.turnBlocked() || d.quitting?.()) return { ok: false, error: "busy" };
  if (d.precheck) {
    try {
      await d.precheck();
    } catch (err) {
      if (err instanceof MoveFailed) return { ok: false, error: err.code };
      console.error("Could not check the new place", err);
      return { ok: false, error: "failed" };
    }
  }
  if (d.checkpoint) {
    try {
      await d.checkpoint();
    } catch (err) {
      console.error("Could not save a checkpoint before the move; the open task resumes from the notes there are", err);
    }
  }
  // Quitting cancels the checkpoint; an engine update or sign-out may have started meanwhile.
  if (d.quitting?.() || d.guards.turnBlocked()) return { ok: false, error: "busy" };
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
