import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Event } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui/client";

export class ChatLog {
  private readonly file: string;

  constructor(folder: string) {
    this.file = path.join(folder, ".harness", "chats", "main.jsonl");
  }

  async append(entry: ChatEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, JSON.stringify(entry) + "\n");
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
}

/** Accumulates one turn's events into the assistant entry that gets saved. */
export class TurnRecorder {
  private text = "";
  private blocks: ChatEntry["blocks"] = [];
  private activities: ChatEntry["activities"] = [];

  constructor(private readonly stateBlocks: Set<string>) {}

  add(e: Event): void {
    if (e.type === "text") this.text += e.delta;
    else if (e.type === "paragraph" && this.text) this.text += "\n\n";
    else if (e.type === "activity" && e.state === "start") this.activities.push({ kind: e.kind, detail: e.detail });
    else if (e.type === "block" && !this.stateBlocks.has(e.name)) this.blocks.push({ name: e.name, data: e.data });
  }

  finish(done: Extract<Event, { type: "done" }>): ChatEntry {
    return {
      id: randomUUID(),
      role: "assistant",
      text: this.text.trim(),
      blocks: this.blocks,
      activities: this.activities,
      at: new Date().toISOString(),
      ...(done.ok ? {} : { error: done.error }),
    };
  }
}
