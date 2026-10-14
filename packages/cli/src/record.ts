// packages/cli/src/record.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MockNote, MockTurn, MockUsage, MockWrite, Recording } from "@humanharness/fake-agent";
import type { Event } from "@humanharness/runtime";

/** Larger files, and files that aren't text, are left out of a recording (spec 3e §3). */
export const MAX_RECORDED_FILE = 64 * 1024;
const SKIPPED_DIRS = new Set([".harness", ".git", "node_modules"]);

export interface FolderSnapshot {
  /** Relative path (with /) → content. */
  files: Map<string, string>;
  /** Relative paths left out: binary or larger than MAX_RECORDED_FILE. */
  skipped: Set<string>;
}

/** The folder's small text files, `.harness/` left out. Symbolic links are skipped, never followed. */
export async function snapshotFolder(folder: string): Promise<FolderSnapshot> {
  const snap: FolderSnapshot = { files: new Map(), skipped: new Set() };
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(folder, abs).split(path.sep).join("/");
      if (e.isSymbolicLink()) {
        // Never read through a link: it may point outside the folder.
        snap.skipped.add(rel);
      } else if (e.isDirectory()) {
        if (!SKIPPED_DIRS.has(e.name)) await walk(abs);
      } else if (e.isFile()) {
        const stat = await fs.lstat(abs);
        if (stat.size > MAX_RECORDED_FILE) {
          snap.skipped.add(rel);
          continue;
        }
        const buf = await fs.readFile(abs);
        if (buf.includes(0)) snap.skipped.add(rel);
        else snap.files.set(rel, buf.toString("utf8"));
      }
    }
  };
  await walk(folder);
  return snap;
}

function diff(before: FolderSnapshot, after: FolderSnapshot): MockWrite[] {
  const writes: MockWrite[] = [];
  for (const [p, content] of after.files) if (before.files.get(p) !== content) writes.push({ path: p, content });
  for (const p of before.files.keys()) if (!after.files.has(p) && !after.skipped.has(p)) writes.push({ path: p, content: null });
  return writes.sort((a, b) => a.path.localeCompare(b.path));
}

export interface RecorderOptions {
  folder: string;
  /** The MCP tool a block is shown with (`blockToolName` over the harness's blocks). */
  toolFor: (block: string) => string;
  /** The text a task's first message contains for this action (its brief's first line). */
  matchFor: (action: string) => string;
  recordedWith: string;
}

/** Builds recordings from one `run`: what the engine answered, what the person replied, what changed. */
export class Recorder {
  private readonly byAction = new Map<string, Recording>();
  private text = "";
  private blocks: MockTurn["blocks"] = [];
  private usage: MockUsage | undefined;
  private lastNote: MockNote | undefined;
  private replyKey: string | undefined;
  private lastTurn: { action: string; turn: MockTurn } | undefined;
  /** A closing turn that ended before its note was written. */
  private pendingClose: MockTurn | undefined;
  private snapshot: FolderSnapshot = { files: new Map(), skipped: new Set() };
  /** Every path skipped at least once, for the run's output. */
  readonly skipped = new Set<string>();

  constructor(private readonly o: RecorderOptions) {}

  /** The folder as it is before the first turn. */
  async begin(): Promise<void> {
    this.snapshot = await snapshotFolder(this.o.folder);
  }

  event(e: Event): void {
    if (e.type === "text") this.text += e.delta;
    else if (e.type === "paragraph") this.text += "\n\n";
    else if (e.type === "usage") this.usage = { input: e.inputTokens, output: e.outputTokens, cacheRead: e.cacheReadTokens, cacheWrite: e.cacheWriteTokens };
    else if (e.type === "block" && e.name !== "save_note" && typeof e.data === "object" && e.data !== null) {
      this.blocks.push({ tool: this.o.toolFor(e.name), input: e.data as Record<string, unknown> });
    }
  }

  /** What the person answered the last turn with: a choice's label, or `*` for typed text. */
  reply(key: string): void {
    this.replyKey = key;
  }

  /** A note TaskManager wrote. It may come before or after its closing turn's `turnEnded`. */
  note(note: MockNote): void {
    if (this.pendingClose) {
      this.pendingClose.note = note;
      this.pendingClose = undefined;
    } else this.lastNote = note;
  }

  /** One engine turn ended (`recordUsage`): it becomes a recorded turn unless it was a checkpoint. */
  async turnEnded(meta: { action?: string; phase?: "run" | "close" | "checkpoint" }): Promise<void> {
    const after = await snapshotFolder(this.o.folder);
    for (const p of after.skipped) this.skipped.add(p);
    const writes = diff(this.snapshot, after);
    this.snapshot = after;
    const action = meta.action;
    const taken = { text: this.text, blocks: this.blocks, usage: this.usage };
    this.text = "";
    this.blocks = [];
    this.usage = undefined;
    if (!action || meta.phase === "checkpoint") return;
    let rec = this.byAction.get(action);
    if (!rec) {
      rec = { version: 1, action, match: this.o.matchFor(action), recordedWith: this.o.recordedWith, turns: [] };
      this.byAction.set(action, rec);
    }
    const id = meta.phase === "close" ? "close" : `t${rec.turns.filter((t) => t.id !== "close").length + 1}`;
    const turn: MockTurn = {
      id,
      text: taken.text,
      blocks: taken.blocks,
      writes,
      ...(taken.usage ? { usage: taken.usage } : {}),
      ...(meta.phase === "close" && this.lastNote ? { note: this.lastNote } : {}),
    };
    rec.turns.push(turn);
    if (meta.phase !== "close" && this.lastTurn?.action === action && this.replyKey !== undefined) {
      this.lastTurn.turn.next = { ...this.lastTurn.turn.next, [this.replyKey]: id };
    }
    this.replyKey = undefined;
    if (meta.phase === "close") {
      if (!turn.note) this.pendingClose = turn;
      this.lastNote = undefined;
      this.lastTurn = undefined;
    } else this.lastTurn = { action, turn };
  }

  recordings(): Recording[] {
    return [...this.byAction.values()];
  }
}
