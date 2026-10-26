import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAIN_SCOPE, chatFile, chatsDir, isScopeDir } from "@humanharness/workspace";
import type { BlockAnswer } from "@humanharness/harness-sdk";
import type { Event, LimitWindow } from "@humanharness/runtime";
import { type AnswerPart, type ChatEntry, type TurnUsage, addParagraph, addText, finishParts } from "@humanharness/ui/client";

export class ChatLog {
  private readonly file: string;

  /**
   * `engine`, when given, is stamped on every appended entry (used to notice an engine switch). `scope` picks the
   * scope's chat (`chats/<scope>.jsonl`); `main`, the default, is also the chat of a harness without scopes.
   */
  constructor(
    folder: string,
    private readonly engine?: string,
    private readonly scope: string = MAIN_SCOPE,
  ) {
    this.file = chatFile(folder, scope);
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

  async append(entry: ChatEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, JSON.stringify(this.engine ? { ...entry, engine: this.engine } : entry) + "\n");
  }

  async load(limit = 200): Promise<ChatEntry[]> {
    let raw: string;
    try {
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

  /** Moves the conversation to `chats/archive/<time>-<label>.jsonl`. Null when there was none. */
  async archive(label: string): Promise<string | null> {
    try {
      await fs.access(this.file);
    } catch {
      return null;
    }
    const dir = path.join(path.dirname(this.file), "archive");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const scope = this.scope === MAIN_SCOPE ? "" : `${this.scope}-`;
    const target = path.join(dir, `${stamp}-${scope}${label.replace(/[^a-z0-9-]/gi, "")}.jsonl`);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(this.file, target);
    return target;
  }
}

/** Accumulates one turn's events into the assistant entry that gets saved. */
export class TurnRecorder {
  private text = "";
  private blocks: ChatEntry["blocks"] = [];
  /** Text runs and blocks in the order they arrived (the window shows them so). */
  private parts: AnswerPart[] = [];
  private activities: ChatEntry["activities"] = [];
  private usage: TurnUsage | undefined;
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
      };
    }
  }

  finish(done: Extract<Event, { type: "done" }>): ChatEntry {
    return {
      id: randomUUID(),
      role: "assistant",
      text: this.text.trim(),
      blocks: this.blocks,
      parts: finishParts(this.parts),
      activities: this.activities,
      at: new Date().toISOString(),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.limits ? { limits: this.limits } : {}),
      ...(Object.keys(this.state).length ? { state: this.state } : {}),
      ...(done.ok ? {} : { error: done.error }),
    };
  }
}
