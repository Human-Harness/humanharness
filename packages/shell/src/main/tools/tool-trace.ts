import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { LinkRefused, checkFolders, isTaskId, readNoLinks, removeNoLinks, writeNoLinks } from "@humanharness/workspace";
import type { TraceAccess, TraceLog } from "./tool-broker";

/**
 * The tool trace (tools spec §8.1, Decision 8): one JSON line per call, in `.harness/trace/<task>.jsonl` for a task's
 * calls, `.harness/trace/jobs/<run>.jsonl` for a job run's (whatever the job runs), and `.harness/trace/ui/<day>.jsonl`
 * for the UI's calls with no task. The registry hands entries already redacted and cut; this file only places them.
 * Every path comes from a task or run id that passes `isTaskId` (never a path from a caller), every folder below the
 * base is walked with lstat (no links), and the file is opened with O_NOFOLLOW. The history never tracks it (it sits
 * under `.harness/`). Nothing is created until a call is traced: a harness without tools never gets the folder (D0).
 */

/** Who made a call (tools spec §5): the harness UI, the agent (task or job slot), a pre-step, a job recipe step. */
export type ToolCaller = "ui" | "agent" | "pre" | "job";

/** One call (§8.1, plus `run` and `result`). `args` and `result` are the value, or `{ cut: true, text }` past 2 KB. */
export interface TraceEntry {
  at: string;
  tool: string;
  caller: ToolCaller;
  task?: string;
  job?: string;
  run?: string;
  phase?: string;
  args: unknown;
  result?: unknown;
  resultSummary: string;
  ms: number;
  ok: boolean;
  error?: string;
  accesses: TraceAccess[];
  /** The call's `ctx.log` lines (spec §4.2), keys hidden then cut; absent when it logged none. */
  logs?: TraceLog[];
  /** Set on a note, not a call (a pre-step's cut, an expected tool not called; spec §6): one line, ≤ NOTE_CHARS. */
  note?: string;
}

/** A trace note's longest text, in code points (P6). */
export const NOTE_CHARS = 200;

/** Entries older than this are pruned at start. */
export const TRACE_DAYS = 30;
/** A trace file stops growing here (entries past it are dropped, logged once per file). */
export const TRACE_FILE_MAX_BYTES = 16 * 1024 * 1024;
const READ_MAX_BYTES = TRACE_FILE_MAX_BYTES + 1024 * 1024;
const DAY_MS = 24 * 60 * 60_000;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NOT_AN_ID = "Not a task or run id";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ToolTraceDeps {
  /** The base the calls run in (`.harness/trace/` goes under it). */
  base: string;
  now?(): Date;
  log?(message: string, err?: unknown): void;
}

export class ToolTrace {
  private readonly full = new Set<string>();

  constructor(private readonly d: ToolTraceDeps) {}

  private get dir(): string {
    return path.join(this.d.base, ".harness", "trace");
  }

  private idFile(id: unknown, sub?: string): string {
    if (!isTaskId(id)) throw new Error(NOT_AN_ID);
    return sub ? path.join(this.dir, sub, `${id}.jsonl`) : path.join(this.dir, `${id}.jsonl`);
  }

  /** Where an entry goes: its task's file, else its job run's, else the UI's file of its day. */
  private fileOf(e: TraceEntry): string {
    if (e.task !== undefined) return this.idFile(e.task);
    if (e.run !== undefined) return this.idFile(e.run, "jobs");
    const day = typeof e.at === "string" && DAY.test(e.at.slice(0, 10)) ? e.at.slice(0, 10) : this.now().toISOString().slice(0, 10);
    return path.join(this.dir, "ui", `${day}.jsonl`);
  }

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  /** Appends one entry as one line. Rejects on a link or a non-file on the way; the caller logs it. */
  async append(e: TraceEntry): Promise<void> {
    const file = this.fileOf(e);
    await checkFolders(this.d.base, file, true);
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(file, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | NOFOLLOW, 0o600);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ELOOP" || code === "EMLINK") throw new LinkRefused(`${path.relative(this.d.base, file)} is a link`);
      throw err;
    }
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.nlink > 1) throw new LinkRefused(`${path.relative(this.d.base, file)} is not a plain file`);
      if (st.size >= TRACE_FILE_MAX_BYTES) {
        if (!this.full.has(file)) this.d.log?.(`The tool trace ${path.relative(this.d.base, file)} is full; later calls are not traced`);
        this.full.add(file);
        return;
      }
      // A torn last line (a crash mid-write) stays on its own line: the new entry starts a line.
      let lead = "";
      if (st.size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, st.size - 1);
        if (last[0] !== 0x0a) lead = "\n";
      }
      await handle.write(`${lead}${JSON.stringify(e)}\n`);
    } finally {
      await handle.close();
    }
  }

  /** A task's or a job run's entries, oldest first; a line that doesn't parse (a torn last line) is skipped. */
  async read(id: string): Promise<TraceEntry[]> {
    const out: TraceEntry[] = [];
    for (const file of [this.idFile(id), this.idFile(id, "jobs")]) {
      const text = await readNoLinks(this.d.base, file, READ_MAX_BYTES);
      if (text !== null) out.push(...entries(text));
    }
    return out;
  }

  /** At start: removes files untouched for TRACE_DAYS and the lines older than that in the rest. Never throws. */
  async prune(): Promise<void> {
    const cutoff = this.now().getTime() - TRACE_DAYS * DAY_MS;
    for (const sub of ["", "jobs", "ui"]) {
      const folder = path.join(this.dir, sub);
      let names: string[];
      try {
        // Walks .harness, trace and the sub-folder: a link anywhere ends the prune of that folder.
        if (!(await checkFolders(this.d.base, path.join(folder, "_")))) continue;
        names = (await fs.readdir(folder, { withFileTypes: true })).filter((x) => x.isFile() && x.name.endsWith(".jsonl")).map((x) => x.name);
      } catch (err) {
        this.d.log?.(`The tool trace was not pruned (${path.relative(this.d.base, folder) || "."})`, err);
        continue;
      }
      for (const name of names) {
        const file = path.join(folder, name);
        try {
          const st = await fs.lstat(file);
          if (!st.isFile() || st.nlink > 1) continue;
          if (st.mtimeMs < cutoff) {
            await removeNoLinks(this.d.base, file);
            continue;
          }
          const text = await readNoLinks(this.d.base, file, READ_MAX_BYTES);
          if (text === null) continue;
          const lines = text.split("\n").filter((l) => l !== "");
          const kept = lines.filter((l) => {
            const at = Date.parse(parsed(l)?.at ?? "");
            return Number.isFinite(at) && at >= cutoff;
          });
          if (kept.length === lines.length) continue;
          if (kept.length === 0) await removeNoLinks(this.d.base, file);
          else await writeNoLinks(this.d.base, file, `${kept.join("\n")}\n`);
        } catch (err) {
          this.d.log?.(`The tool trace ${path.relative(this.d.base, file)} was not pruned`, err);
        }
      }
    }
  }
}

function parsed(line: string): TraceEntry | null {
  try {
    const v = JSON.parse(line) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as TraceEntry) : null;
  } catch {
    return null;
  }
}

function entries(text: string): TraceEntry[] {
  const out: TraceEntry[] = [];
  for (const l of text.split("\n")) {
    if (l === "") continue;
    const e = parsed(l);
    if (!e) continue;
    // The file is read unchecked: a note is kept only as the registry writes it, a string of at most NOTE_CHARS.
    if (e.note !== undefined && (typeof e.note !== "string" || [...e.note].length > NOTE_CHARS)) delete e.note;
    out.push(e);
  }
  return out;
}
