import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { chatsDir, isScopeDir, taskChatFile } from "@humanharness/workspace";
import { ChatLog } from "./chat-log";

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
 * A task chat with lines of its own is kept as it is; the scope's chat then only goes to the archive.
 */
export async function migrateChats(base: string, open: readonly { scope: string; task: string }[]): Promise<{ copied: string[]; archived: string[] }> {
  const dir = chatsDir(base);
  const marker = path.join(dir, MARKER);
  if (await fs.access(marker).then(() => true, () => false)) return { copied: [], archived: [] };
  // Every target is checked before anything moves: a bad id or scope throws here.
  for (const o of open) taskChatFile(base, o.scope, o.task);
  const copied: string[] = [];
  const archived: string[] = [];
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    const scope = name.slice(0, -".jsonl".length);
    if (!isScopeDir(scope)) continue;
    const owner = open.find((o) => o.scope === scope);
    if (owner && (await copyInto(path.join(dir, name), taskChatFile(base, scope, owner.task), dir))) copied.push(scope);
    await new ChatLog(base, undefined, scope).archive("parallel");
    archived.push(scope);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(marker, "");
  return { copied, archived };
}

/**
 * Copies `source` to `target` atomically, unless `target` already holds lines that are not a start of `source`. True
 * when `target` now holds `source`'s content. Throws when `target`'s folder resolves outside `chats` (a symlink).
 */
async function copyInto(source: string, target: string, chats: string): Promise<boolean> {
  const folder = path.dirname(target);
  await fs.mkdir(folder, { recursive: true });
  const [real, realChats] = await Promise.all([fs.realpath(folder), fs.realpath(chats)]);
  const stat = await fs.lstat(target).catch(() => null);
  if (real !== path.join(realChats, path.basename(folder)) || (stat && !stat.isFile())) {
    throw new Error(`The chat of "${path.basename(target)}" is outside the chats folder`);
  }
  const content = await fs.readFile(source, "utf8");
  if (stat) {
    const existing = await fs.readFile(target, "utf8");
    if (existing === content) return true;
    if (!content.startsWith(existing)) return false;
  }
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, { flag: "wx" });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return true;
}
