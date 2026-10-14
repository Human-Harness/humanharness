import { promises as fs } from "node:fs";
import path from "node:path";
import { APP_FOLDERS, type MockNote, type MockTurn, type MockUsage, type MockWrite, type Recording } from "@humanharness/fake-agent";
import type { Event } from "@humanharness/runtime";

/** Larger files, and files that aren't text, are left out of a recording (spec 3e §3). */
export const MAX_RECORDED_FILE = 64 * 1024;
const SKIPPED_DIRS = new Set<string>([...APP_FOLDERS, ".git", "node_modules"]);

export interface FolderSnapshot {
  /** Relative path (with /) → content. */
  files: Map<string, string>;
  /** Relative paths left out: binary or larger than MAX_RECORDED_FILE. */
  skipped: Set<string>;
  /** Size and mtime of each skipped path, to tell which ones changed between snapshots. */
  signatures: Map<string, string>;
}

/** The first line of a brief that a task's first message always contains: past any front matter, before any placeholder. */
export function briefMatch(text: string, fallback: string): string {
  const lines = text.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\{\{.*$/, "").trim();
    if (line) return line;
  }
  return fallback;
}

/** The folder's small text files, app-owned folders and the `exclude`d paths (relative, with /) left out. Symbolic links are skipped, never followed. */
export async function snapshotFolder(folder: string, exclude: readonly string[] = []): Promise<FolderSnapshot> {
  const snap: FolderSnapshot = { files: new Map(), skipped: new Set(), signatures: new Map() };
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(folder, abs).split(path.sep).join("/");
      if (exclude.includes(rel)) continue;
      const skip = async (): Promise<void> => {
        snap.skipped.add(rel);
        const st = await fs.lstat(abs).catch(() => null);
        snap.signatures.set(rel, st ? `${st.size}:${st.mtimeMs}` : "");
      };
      if (e.isSymbolicLink()) {
        // Never read through a link: it may point outside the folder.
        await skip();
      } else if (e.isDirectory()) {
        if (!SKIPPED_DIRS.has(e.name)) await walk(abs);
      } else if (e.isFile()) {
        const stat = await fs.lstat(abs);
        if (stat.size > MAX_RECORDED_FILE) {
          await skip();
          continue;
        }
        const buf = await fs.readFile(abs);
        if (buf.includes(0)) await skip();
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
  /** Files the app generates in the folder (AGENTS.md, the engine's instructions file): never recorded. */
  exclude?: readonly string[];
  /** The MCP tool a block is shown with (`blockToolName` over the harness's blocks). */
  toolFor: (block: string) => string;
  /** The text a task's first message contains for this action (its brief's first line). */
  matchFor: (action: string) => string;
  recordedWith: string;
  /** Something the person should know (a visit that is not recorded). */
  warn?: (message: string) => void;
}

/** Builds recordings from one `run`: what the engine answered, what the person replied, what changed. */
export class Recorder {
  private readonly byAction = new Map<string, Recording>();
  private text = "";
  private blocks: MockTurn["blocks"] = [];
  private usage: MockUsage | undefined;
  private replyKey: string | undefined;
  private lastTurn: { action: string; turn: MockTurn } | undefined;
  /** The turn that ended last: where a note written right after it belongs. `null`: a turn that takes none. */
  private ended: MockTurn | null | undefined;
  /** The task whose visit to each action is being recorded: later visits are ignored. */
  private readonly taskOf = new Map<string, string>();
  private readonly ignored = new Set<string>();
  private snapshot: FolderSnapshot = { files: new Map(), skipped: new Set(), signatures: new Map() };
  /** Skipped paths that are new or changed during the run, for its output. */
  readonly skipped = new Set<string>();

  constructor(private readonly o: RecorderOptions) {}

  /** The folder as it is before the first turn. */
  async begin(): Promise<void> {
    this.snapshot = await snapshotFolder(this.o.folder, this.o.exclude);
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

  /**
   * A note TaskManager wrote. It comes right after its turn ended (`recordUsage` runs first): the closing turn's
   * note, or a run turn's own `save_note`. A checkpoint's note is provisional, and the closing turn replaces it.
   */
  note(note: MockNote): void {
    if (this.ended) this.ended.note = note;
    this.ended = undefined;
  }

  /** One engine turn ended (`recordUsage`): it becomes a recorded turn unless it was a checkpoint. */
  async turnEnded(meta: { action?: string; task?: string; phase?: "run" | "close" | "checkpoint" }, opts: { failed?: boolean } = {}): Promise<void> {
    const after = await snapshotFolder(this.o.folder, this.o.exclude);
    for (const p of after.skipped) if (this.snapshot.signatures.get(p) !== after.signatures.get(p)) this.skipped.add(p);
    this.ended = null;
    if (opts.failed) {
      // A failed or held attempt is no turn: drop what it showed. The snapshot and the pending reply stay,
      // so the retry's turn carries any files the attempt wrote and is linked by the same reply.
      this.text = "";
      this.blocks = [];
      this.usage = undefined;
      return;
    }
    const writes = diff(this.snapshot, after);
    this.snapshot = after;
    const action = meta.action;
    const taken = { text: this.text, blocks: this.blocks, usage: this.usage };
    this.text = "";
    this.blocks = [];
    this.usage = undefined;
    if (!action || meta.phase === "checkpoint") return;
    const task = meta.task ?? "";
    const first = this.taskOf.get(action);
    if (first === undefined) this.taskOf.set(action, task);
    else if (first !== task) {
      if (!this.ignored.has(action)) this.o.warn?.(`"${action}" was run again in this folder: only its first visit is recorded.`);
      this.ignored.add(action);
      this.replyKey = undefined;
      return;
    }
    let rec = this.byAction.get(action);
    if (!rec) {
      rec = { version: 1, action, match: this.o.matchFor(action), recordedWith: this.o.recordedWith, turns: [] };
      this.byAction.set(action, rec);
    }
    const id = meta.phase === "close" ? "close" : `t${rec.turns.filter((t) => t.id !== "close").length + 1}`;
    const turn: MockTurn = { id, text: taken.text, blocks: taken.blocks, writes, ...(taken.usage ? { usage: taken.usage } : {}) };
    rec.turns.push(turn);
    if (meta.phase !== "close" && this.lastTurn?.action === action && this.replyKey !== undefined) {
      this.lastTurn.turn.next = { ...this.lastTurn.turn.next, [this.replyKey]: id };
    }
    this.replyKey = undefined;
    this.ended = turn;
    this.lastTurn = meta.phase === "close" ? undefined : { action, turn };
  }

  recordings(): Recording[] {
    return [...this.byAction.values()];
  }
}
