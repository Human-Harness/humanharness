import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { MAIN_SCOPE, chatFile, chatsDir, isScopeDir, isTaskId, taskChatFile } from "@humanharness/workspace";
import type { BlockAnswer } from "@humanharness/harness-sdk";
import type { Event, LimitWindow } from "@humanharness/runtime";
import { type AnswerPart, type ChatEntry, type DocumentCard, type TurnUsage, addParagraph, addText, finishParts } from "@humanharness/ui/client";

export class ChatLog {
  private readonly file: string;

  /**
   * `engine`, when given, is stamped on every appended entry (used to notice an engine switch). `scope` picks the
   * scope's chat (`chats/<scope>.jsonl`); `main`, the default, is also the chat of a harness without scopes.
   */
  constructor(
    private readonly folder: string,
    private readonly engine?: string,
    private readonly scope: string = MAIN_SCOPE,
    /** Board mode (parallel spec §6): the task's own chat, `chats/<scope>/<task>.jsonl`. Absent: the scope's chat, as before. */
    private readonly task?: string,
  ) {
    this.file = task === undefined ? chatFile(folder, scope) : taskChatFile(folder, scope, task);
  }

  /**
   * A task chat sits in a folder of its own, which a symlink could point elsewhere: its folder must resolve to
   * `chats/<scope>/`, and the file must be a plain file with no other name (no symlink, no hard link). Throws
   * otherwise. Only called for a task chat: a scope's chat is not checked (as before).
   */
  private async checkInside(): Promise<void> {
    await assertInChats(this.folder, path.dirname(this.file));
    const file = await fs.lstat(this.file).catch(() => null);
    if (file && (!file.isFile() || file.nlink > 1)) throw new Error(`The chat of task "${this.task}" is outside the chats folder`);
  }

  /** The scopes that have a chat file in `folder` (`_app` included), sorted. */
  static async scopesIn(folder: string): Promise<string[]> {
    const names = await fs.readdir(chatsDir(folder)).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.slice(0, -".jsonl".length))
      .filter((s) => isScopeDir(s))
      .sort();
  }

  /**
   * The task chats in `folder` (board mode, `chats/<scope>/<task>.jsonl`), sorted. Only real folders directly under
   * `chats/` with a scope's name count (never `archive`, never a symlink); a folder that can't be read is skipped.
   */
  static async taskChatsIn(folder: string): Promise<{ scope: string; task: string }[]> {
    const dirs = await fs.readdir(chatsDir(folder), { withFileTypes: true }).catch(() => []);
    const out: { scope: string; task: string }[] = [];
    for (const d of dirs) {
      if (!d.isDirectory() || d.name === "archive" || !isScopeDir(d.name)) continue;
      const names = await fs.readdir(path.join(chatsDir(folder), d.name)).catch(() => [] as string[]);
      for (const n of names) {
        const task = n.endsWith(".jsonl") ? n.slice(0, -".jsonl".length) : "";
        if (isTaskId(task)) out.push({ scope: d.name, task });
      }
    }
    return out.sort((a, b) => (a.scope === b.scope ? (a.task < b.task ? -1 : 1) : a.scope < b.scope ? -1 : 1));
  }

  async append(entry: ChatEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const line = JSON.stringify(this.engine ? { ...entry, engine: this.engine } : entry) + "\n";
    if (this.task === undefined) return fs.appendFile(this.file, line);
    await this.checkInside();
    await fs.appendFile(this.file, line, { flag: constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW });
  }

  async load(limit = 200): Promise<ChatEntry[]> {
    let raw: string;
    try {
      if (this.task !== undefined) await this.checkInside();
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const entries: ChatEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as ChatEntry);
      } catch {
        // skip a broken line
      }
    }
    return entries.slice(-limit);
  }

  /**
   * Puts the person's answer on the block it answers (input-blocks spec §8). The file is rewritten atomically
   * (temp + rename), keeping every other line as it was. The last block with that id gets it, replacing an
   * earlier answer (a send stopped before its turn reopens the question, and the second answer wins). False when
   * no block has that id.
   * It must not run while the chat file can be appended to: an append landing between the read and the rename
   * is lost. `TaskManager.respond` calls it inside its operation, with no turn running.
   */
  async markAnswered(answer: BlockAnswer): Promise<boolean> {
    let raw: string;
    try {
      if (this.task !== undefined) await this.checkInside();
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return false;
    }
    const lines = raw.split("\n");
    let found = false;
    for (let n = lines.length - 1; n >= 0 && !found; n--) {
      if (!lines[n].trim()) continue;
      let entry: ChatEntry;
      try {
        entry = JSON.parse(lines[n]) as ChatEntry;
      } catch {
        continue;
      }
      const i = Array.isArray(entry.blocks) ? entry.blocks.findLastIndex((b) => b.id === answer.blockId) : -1;
      if (i < 0) continue;
      found = true;
      lines[n] = JSON.stringify({ ...entry, blocks: entry.blocks.map((b, j) => (j === i ? { ...b, input: answer } : b)) });
    }
    if (!found) return false;
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, lines.join("\n"));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return true;
  }

  /**
   * Moves the conversation to `chats/archive/<time>-<label>.jsonl` (`<time>-<scope>-<label>` outside `main`). A
   * task's chat goes to `<time>-<scope>.<task>.<label>.jsonl`, dots that no scope chat's name has; a task id longer
   * than 64 is shortened with a hash, so the name stays well under a file system's limit. An archive is never
   * overwritten: a name already taken gets `-2`, `-3`… Null when there was no conversation.
   */
  async archive(label: string): Promise<string | null> {
    try {
      await fs.access(this.file);
    } catch {
      return null;
    }
    const dir = path.join(chatsDir(this.folder), "archive");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const clean = label.replace(/[^a-z0-9-]/gi, "");
    let name: string;
    if (this.task !== undefined) {
      await this.checkInside();
      name = `${stamp}-${this.scope}.${shortTask(this.task)}.${clean.slice(0, 40)}`;
    } else name = `${stamp}-${this.scope === MAIN_SCOPE ? "" : `${this.scope}-`}${clean}`;
    await fs.mkdir(dir, { recursive: true });
    if (this.task !== undefined) await assertInChats(this.folder, dir);
    let target = path.join(dir, `${name}.jsonl`);
    for (let n = 2; await fs.lstat(target).then(() => true, () => false); n++) target = path.join(dir, `${name}-${n}.jsonl`);
    await fs.rename(this.file, target);
    return target;
  }
}

/** A task id for an archive name: as it is up to 64 characters, else its start and a hash of the whole. */
const shortTask = (task: string): string => (task.length <= 64 ? task : `${task.slice(0, 40)}-${createHash("sha256").update(task).digest("hex").slice(0, 16)}`);

/**
 * Throws unless `dir` (an existing folder directly under `<base>/.harness/chats/`) resolves to that place: a symlink
 * there must not lead a chat out of the chats folder.
 */
export async function assertInChats(base: string, dir: string): Promise<void> {
  const [real, chats] = await Promise.all([fs.realpath(dir), fs.realpath(chatsDir(base))]);
  if (real !== path.join(chats, path.basename(dir))) throw new Error(`"${path.basename(dir)}" is outside the chats folder`);
}

/** Accumulates one turn's events into the assistant entry that gets saved. */
export class TurnRecorder {
  private text = "";
  private blocks: ChatEntry["blocks"] = [];
  /** Text runs and blocks in the order they arrived (the window shows them so). */
  private parts: AnswerPart[] = [];
  private activities: ChatEntry["activities"] = [];
  private usage: TurnUsage | undefined;
  /** The cards for the `.md` files the turn added or changed (none: the entry has no field). */
  private documents: DocumentCard[] | undefined;
  private limits: LimitWindow[] | undefined;
  /** The turn's first limits snapshot (the reply keeps the last): usage estimates measure from it. */
  firstLimits: LimitWindow[] | undefined;
  private state: Record<string, unknown> = {};

  constructor(private readonly stateBlocks: Set<string>) {}

  add(e: Event): void {
    if (e.type === "text") {
      this.text += e.delta;
      this.parts = addText(this.parts, e.delta);
    } else if (e.type === "paragraph" && this.text) {
      this.text += "\n\n";
      this.parts = addParagraph(this.parts);
    } else if (e.type === "activity" && e.state === "start") this.activities.push({ kind: e.kind, detail: e.detail });
    else if (e.type === "block") {
      if (this.stateBlocks.has(e.name)) this.state[e.name] = e.data;
      else {
        this.parts.push({ block: this.blocks.length });
        this.blocks.push({ name: e.name, data: e.data, ...(e.id ? { id: e.id } : {}) });
      }
    } else if (e.type === "limits") {
      this.firstLimits ??= e.windows;
      this.limits = e.windows;
    }
    else if (e.type === "usage") {
      this.usage = {
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        cacheWriteTokens: e.cacheWriteTokens,
        ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
      };
    } else if (e.type === "documents") this.documents = e.documents;
  }

  finish(done: Extract<Event, { type: "done" }>): ChatEntry {
    return {
      id: randomUUID(),
      role: "assistant",
      text: this.text.trim(),
      blocks: this.blocks,
      parts: finishParts(this.parts),
      ...(this.documents ? { documents: this.documents } : {}),
      activities: this.activities,
      at: new Date().toISOString(),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.limits ? { limits: this.limits } : {}),
      ...(Object.keys(this.state).length ? { state: this.state } : {}),
      ...(done.ok ? {} : { error: done.error }),
    };
  }
}
