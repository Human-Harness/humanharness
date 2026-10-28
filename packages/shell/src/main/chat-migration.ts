import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { chatsDir, isScopeDir, taskChatFile } from "@humanharness/workspace";
import { ChatLog, assertInChats } from "./chat-log";

/** The marker that the move to per-task chats ran in this folder. */
const MARKER = ".per-task";

/**
 * The one-time move to per-task chats (parallel spec §6, Decision 8). Board mode only: a harness without `parallel`
 * never calls it. For each `<scope>.jsonl`: when that scope's last task is still open (`open`), its content is copied
 * to that task's chat; then the scope file is archived (`ChatLog.archive("parallel")`, a rename, so its lines are never
 * lost). A file is archived only after its copy succeeded; a marker written last makes it run once.
 *
 * Crash-safe and idempotent: every step can be repeated. The copy is atomic (temp + rename), and a rerun copies again
 * only when the task's chat is a start of the scope's chat (an earlier copy, or a shorter one), so no line is doubled.
 * A task chat with lines of its own is kept as it is (`kept`, logged); the scope's chat then only goes to the archive.
 * A scope chat that is not a plain file (a symlink, a hard link) is never read: it is only archived (logged).
 */
export async function migrateChats(
  base: string,
  open: readonly { scope: string; task: string }[],
  log: (message: string) => void = (m) => console.warn(m),
): Promise<{ copied: string[]; archived: string[]; kept: string[] }> {
  const dir = chatsDir(base);
  const marker = path.join(dir, MARKER);
  if (await fs.access(marker).then(() => true, () => false)) return { copied: [], archived: [], kept: [] };
  // Every target is checked before anything moves: a bad id or scope throws here.
  for (const o of open) taskChatFile(base, o.scope, o.task);
  const copied: string[] = [];
  const archived: string[] = [];
  const kept: string[] = [];
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl") && isScopeDir(n.slice(0, -".jsonl".length)));
  if (names.length > 0) {
    // A symlinked archive folder would take the scope chats out of the chats folder.
    await fs.mkdir(path.join(dir, "archive"), { recursive: true });
    await assertInChats(base, path.join(dir, "archive"));
  }
  for (const name of names.sort()) {
    const scope = name.slice(0, -".jsonl".length);
    const owner = open.find((o) => o.scope === scope);
    if (owner) {
      const outcome = await copyInto(path.join(dir, name), taskChatFile(base, scope, owner.task), base);
      if (outcome === "copied") copied.push(scope);
      else if (outcome === "kept") {
        kept.push(scope);
        log(`Chat move: the chat of task ${owner.task} already had lines of its own; the ${scope} chat went to the archive only`);
      } else log(`Chat move: the ${scope} chat is not a plain file; it went to the archive without being read`);
    }
    await new ChatLog(base, undefined, scope).archive("parallel");
    archived.push(scope);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(marker, "");
  return { copied, archived, kept };
}

/**
 * Copies `source` to `target` atomically, unless `target` already holds lines that are not a start of `source`
 * ("kept"). "copied" when `target` now holds `source`'s content; "skipped" when `source` is not a plain file with one
 * name, which is never read. Throws when `target`'s folder resolves outside the chats folder or `target` is a link.
 */
async function copyInto(source: string, target: string, base: string): Promise<"copied" | "kept" | "skipped"> {
  const folder = path.dirname(target);
  await fs.mkdir(folder, { recursive: true });
  await assertInChats(base, folder);
  const stat = await fs.lstat(target).catch(() => null);
  if (stat && (!stat.isFile() || stat.nlink > 1)) throw new Error(`The chat of "${path.basename(target)}" is outside the chats folder`);
  const content = await readPlain(source);
  if (content === null) return "skipped";
  if (stat) {
    const existing = await fs.readFile(target, "utf8");
    if (existing === content) return "copied";
    if (!content.startsWith(existing)) return "kept";
  }
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, { flag: "wx" });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return "copied";
}

/** `file`'s content when it is a plain file with one name, opened without following a link; null otherwise. */
async function readPlain(file: string): Promise<string | null> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.nlink > 1) return null;
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink > 1 || opened.ino !== stat.ino) return null;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
