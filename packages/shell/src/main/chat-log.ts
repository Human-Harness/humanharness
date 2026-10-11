import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Event, LimitWindow } from "@humanharness/runtime";
import type { ChatEntry, TurnUsage } from "@humanharness/ui/client";

export class ChatLog {
  private readonly file: string;

  /** `engine`, when given, is stamped on every appended entry (used to notice an engine switch). */
  constructor(
    folder: string,
    private readonly engine?: string,
  ) {
    this.file = path.join(folder, ".harness", "chats", "main.jsonl");
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

  /** Moves the conversation to `chats/archive/<time>-<label>.jsonl`. Null when there was none. */
  async archive(label: string): Promise<string | null> {
    try {
      await fs.access(this.file);
    } catch {
      return null;
    }
    const dir = path.join(path.dirname(this.file), "archive");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(dir, `${stamp}-${label.replace(/[^a-z0-9-]/gi, "")}.jsonl`);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(this.file, target);
    return target;
  }
}

/** Accumulates one turn's events into the assistant entry that gets saved. */
export class TurnRecorder {
  private text = "";
  private blocks: ChatEntry["blocks"] = [];
  private activities: ChatEntry["activities"] = [];
  private usage: TurnUsage | undefined;
  private limits: LimitWindow[] | undefined;
  private state: Record<string, unknown> = {};

  constructor(private readonly stateBlocks: Set<string>) {}

  add(e: Event): void {
    if (e.type === "text") this.text += e.delta;
    else if (e.type === "paragraph" && this.text) this.text += "\n\n";
    else if (e.type === "activity" && e.state === "start") this.activities.push({ kind: e.kind, detail: e.detail });
    else if (e.type === "block") {
      if (this.stateBlocks.has(e.name)) this.state[e.name] = e.data;
      else this.blocks.push({ name: e.name, data: e.data });
    } else if (e.type === "limits") this.limits = e.windows;
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
      activities: this.activities,
      at: new Date().toISOString(),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.limits ? { limits: this.limits } : {}),
      ...(Object.keys(this.state).length ? { state: this.state } : {}),
      ...(done.ok ? {} : { error: done.error }),
    };
  }
}
