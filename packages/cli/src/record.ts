import { randomBytes } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { APP_FOLDERS, type MockNote, type MockToolCall, type MockTurn, type MockUsage, type MockWrite, type Recording } from "@humanharness/fake-agent";
import { TOOL_ID } from "@humanharness/harness-sdk";
import type { FixtureExchange } from "@humanharness/harness-sdk/plugin-fixtures";
import { FIXTURE_BYTES, FIXTURE_FILES } from "@humanharness/shell/plugins";
import type { Event } from "@humanharness/runtime";
import type { TurnKind } from "@humanharness/shell/tasks";

/** Larger files, and files that aren't text, are left out of a recording (spec 3e §3). */
export const MAX_RECORDED_FILE = 64 * 1024;
const SKIPPED_DIRS = new Set<string>([...APP_FOLDERS, ".git", "node_modules"]);
/** A recorded turn holds at most this many tool calls (the recording format's cap). */
export const MAX_TURN_TOOL_CALLS = 20;

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
  /** The agent's tool calls this turn (tools spec §12), in order; none: the turn has no `tools` key (D0). */
  private tools: MockToolCall[] = [];
  /** This turn's calls went past the cap (warned once). */
  private toolsOver = false;
  private replyKey: string | undefined;
  /** What the person answered the last turn's input block with (`run`'s `a`). */
  private answerKey: { block: string; value: Record<string, unknown> } | undefined;
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

  /**
   * The agent called `tool` on the `tools` server this turn and it answered (tools Decision 9): replay makes the same
   * call. Pre-steps are never recorded here: in mock mode they run for real at the start.
   */
  toolCall(tool: string, args: Record<string, unknown>): void {
    // The recording format refuses these (an own `__proto__` key is dropped by zod): the file would not load.
    if (!TOOL_ID.test(tool) || Object.hasOwn(args, "__proto__")) {
      this.o.warn?.(`a call to a tool was left out of the recording: its name or arguments can't be recorded.`);
      return;
    }
    if (this.tools.length >= MAX_TURN_TOOL_CALLS) {
      if (!this.toolsOver) this.o.warn?.(`a turn made more than ${MAX_TURN_TOOL_CALLS} tool calls: only the first ${MAX_TURN_TOOL_CALLS} are recorded.`);
      this.toolsOver = true;
      return;
    }
    this.tools.push({ tool, args: JSON.parse(JSON.stringify(args)) as Record<string, unknown> });
  }

  /** What the person answered the last turn with: a choice's label, or `*` for typed text. */
  reply(key: string): void {
    this.replyKey = key;
    // An answer whose turn never ended (stopped, not retried) must not take this reply's link.
    this.answerKey = undefined;
  }

  /** The person answered the last turn's input block: replay follows this answer by its JSON (`respond`). */
  answer(block: string, value: Record<string, unknown>): void {
    this.answerKey = { block, value };
    this.replyKey = undefined;
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
  async turnEnded(meta: { action?: string; task?: string; phase?: TurnKind; taskPhase?: string }, opts: { failed?: boolean } = {}): Promise<void> {
    const after = await snapshotFolder(this.o.folder, this.o.exclude);
    for (const p of after.skipped) if (this.snapshot.signatures.get(p) !== after.signatures.get(p)) this.skipped.add(p);
    this.ended = null;
    if (opts.failed) {
      // A failed or held attempt is no turn: drop what it showed. The snapshot and the pending reply stay,
      // so the retry's turn carries any files the attempt wrote and is linked by the same reply.
      this.text = "";
      this.blocks = [];
      this.usage = undefined;
      this.tools = [];
      this.toolsOver = false;
      return;
    }
    const writes = diff(this.snapshot, after);
    this.snapshot = after;
    const action = meta.action;
    const taken = { text: this.text, blocks: this.blocks, usage: this.usage, tools: this.tools };
    this.text = "";
    this.blocks = [];
    this.usage = undefined;
    this.tools = [];
    this.toolsOver = false;
    if (!action || meta.phase === "checkpoint") return;
    const task = meta.task ?? "";
    const first = this.taskOf.get(action);
    if (first === undefined) this.taskOf.set(action, task);
    else if (first !== task) {
      if (!this.ignored.has(action)) this.o.warn?.(`"${action}" was run again in this folder: only its first visit is recorded.`);
      this.ignored.add(action);
      this.replyKey = undefined;
      this.answerKey = undefined;
      return;
    }
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
      // Only a turn that called tools has the key: a recording without tools is written exactly as before (D0).
      ...(taken.tools.length > 0 ? { tools: taken.tools } : {}),
      ...(taken.usage ? { usage: taken.usage } : {}),
      // The app's own prompts (task-phases spec §6): replayed by what they answer, never by a reply.
      ...(meta.phase === "phase-change" && meta.taskPhase ? { setPhase: meta.taskPhase } : {}),
      ...(meta.phase === "wrap-up" ? { timeUp: true as const } : {}),
    };
    rec.turns.push(turn);
    const appPrompt = meta.phase === "phase-change" || meta.phase === "wrap-up";
    // An app prompt takes no link: a reply pending from the turn before is dropped (cleared below), and the run turn
    // after the change links from the change.
    if (meta.phase !== "close" && !appPrompt && this.lastTurn?.action === action) {
      if (this.answerKey) this.lastTurn.turn.respond = [...(this.lastTurn.turn.respond ?? []), { ...this.answerKey, next: id }];
      else if (this.replyKey !== undefined) this.lastTurn.turn.next = { ...this.lastTurn.turn.next, [this.replyKey]: id };
    }
    this.replyKey = undefined;
    this.answerKey = undefined;
    this.ended = turn;
    this.lastTurn = meta.phase === "close" ? undefined : { action, turn };
  }

  recordings(): Recording[] {
    return [...this.byAction.values()];
  }
}

/** One broker access of a run (`fetch` or `exec`) and its reply, as the service answered it: keys still in it. */
export interface ToolExchange {
  tool: string;
  exchange: FixtureExchange;
}

/** The highest number a recorded exchange's file takes: three digits (tools Decision 8). */
const MAX_TOOL_FILE = 999;
const TOOL_FILE = /^(\d{3})\.json$/;

/** `p` is a real folder, made when missing; a link (to a folder or not) or a file is not. */
async function realFolder(p: string): Promise<boolean> {
  await fs.mkdir(p).catch(() => undefined);
  return (await fs.lstat(p).catch(() => null))?.isDirectory() === true;
}

/**
 * Writes `text` at `file` unless a file (or link) is there: a temp file, then a hard link that never replaces one. The
 * temp file's name is random, so one left behind by an earlier run never stops this one, and it is removed whatever
 * fails.
 */
async function writeNew(dir: string, name: string, text: string): Promise<boolean> {
  const tmp = path.join(dir, `.${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await fs.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o644);
  try {
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await handle.close();
    }
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  try {
    await fs.link(tmp, path.join(dir, name));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * `run --record`'s broker accesses (tools Decision 8, A3): each exchange, with every form of `keys` replaced by
 * `{{secret:<id>}}` (`strip`, P11), in `<mock>/tools/<tool>/<NNN>.json`, one plugin fixture exchange per file, numbered
 * after the highest file there. A file that still holds a key, or isn't a valid exchange, is not written and named.
 * Nothing is ever overwritten and no link is followed (`mock/tools/`, `<tool>/`, the file). Returns how many were written;
 * `say` gets one line per file (only fixed texts, tool ids and numbers: no key, no reply text).
 */
export async function writeToolRecordings(
  mockDir: string,
  exchanges: readonly ToolExchange[],
  strip: (exchange: FixtureExchange) => { exchange: FixtureExchange; leaked: boolean },
  say: (line: string) => void,
): Promise<number> {
  if (exchanges.length === 0) return 0;
  if (!(await realFolder(mockDir))) {
    say("Not recorded: mock/ is not a folder");
    return 0;
  }
  const toolsDir = path.join(mockDir, "tools");
  if (!(await realFolder(toolsDir))) {
    say("Not recorded: mock/tools/ is not a folder");
    return 0;
  }
  const byTool = new Map<string, FixtureExchange[]>();
  for (const e of exchanges) {
    if (!TOOL_ID.test(e.tool)) continue;
    byTool.set(e.tool, [...(byTool.get(e.tool) ?? []), e.exchange]);
  }
  let written = 0;
  for (const [tool, list] of byTool) {
    const dir = path.join(toolsDir, tool);
    if (!(await realFolder(dir))) {
      say(`Not recorded: mock/tools/${tool}/ is not a folder`);
      continue;
    }
    const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    let count = names.length;
    let next = Math.max(0, ...names.map((f) => Number(TOOL_FILE.exec(f)?.[1] ?? 0))) + 1;
    for (const [i, exchange] of list.entries()) {
      if (count >= FIXTURE_FILES || next > MAX_TOOL_FILE) {
        say(`Not recorded: mock/tools/${tool}/ is full (mock mode reads at most ${FIXTURE_FILES} files a tool, numbered up to ${String(MAX_TOOL_FILE)})`);
        break;
      }
      const rel = () => `mock/tools/${tool}/${String(next).padStart(3, "0")}.json`;
      // A skipped exchange takes no number (the next one does): it is named by its place in this run.
      const skipped = `exchange ${i + 1} of ${tool}`;
      let stripped: { exchange: FixtureExchange; leaked: boolean } | null = null;
      try {
        stripped = strip(exchange);
      } catch {
        // Stripping broke the exchange, or it was never a valid one: nothing is written.
      }
      if (!stripped) {
        say(`Not recorded: ${skipped} is not an exchange mock mode can play`);
        continue;
      }
      if (stripped.leaked) {
        say(`Not recorded: ${skipped} holds a key`);
        continue;
      }
      const text = `${JSON.stringify(stripped.exchange, null, 2)}\n`;
      if (Buffer.byteLength(text) > FIXTURE_BYTES) {
        say(`Not recorded: ${skipped} is over 10 MB`);
        continue;
      }
      // A file that appeared since the folder was read takes its number: the next one is tried.
      while (next <= MAX_TOOL_FILE && !(await writeNew(dir, `${String(next).padStart(3, "0")}.json`, text))) next++;
      if (next > MAX_TOOL_FILE) continue;
      say(`Recorded: ${rel()}`);
      written++;
      count++;
      next++;
    }
  }
  return written;
}
