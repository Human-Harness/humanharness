import { promises as fs } from "node:fs";
import path from "node:path";
import { BACKEND_LOG_MAX_BYTES } from "@humanharness/harness-sdk";

/** One logged line is cut to this many bytes (UTF-8), so one runaway line can't fill the log. */
const LINE_MAX_BYTES = 8 * 1024;

export type BackendLogStream = "stderr" | "app";

/** `text` cut to at most `max` UTF-8 bytes on a character boundary, marked with "…" when cut. */
function cutLine(text: string, max: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  let end = max;
  // Back off continuation bytes (10xxxxxx) so the cut never splits a character.
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return `${buf.subarray(0, end).toString("utf8")}…`;
}

/**
 * The harness backend's log (hatches spec §4.3; threat model B5): `backend.log` in the app's data folder, the
 * backend's stderr and the app's notes about it, one time-stamped line each. Past `max` bytes the file is rotated to
 * `backend.log.1` (replacing the older one), so a noisy backend holds at most two files. Writes run one at a time.
 * It never throws: a failure is reported once to the main log and the write resolves.
 */
export class BackendLog {
  private readonly dir: string;
  private readonly file: string;
  private readonly max: number;
  private readonly now: () => Date;
  private queue: Promise<void> = Promise.resolve();
  private reported = false;

  constructor(dir: string, opts: { max?: number; now?: () => Date } = {}) {
    this.dir = dir;
    this.file = path.join(dir, "backend.log");
    this.max = opts.max ?? BACKEND_LOG_MAX_BYTES;
    this.now = opts.now ?? (() => new Date());
  }

  /** Appends `text` split into lines (blank ones skipped, each cut at 8 KB), prefixed with the time and `stream`. */
  write(stream: BackendLogStream, text: string): Promise<void> {
    const at = this.now().toISOString();
    const lines = text
      .split("\n")
      .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
      .filter((l) => l.length > 0)
      .map((l) => `${at} ${stream} ${cutLine(l, LINE_MAX_BYTES)}\n`);
    if (lines.length === 0) return this.queue;
    const chunk = lines.join("");
    this.queue = this.queue.then(() => this.append(chunk));
    return this.queue;
  }

  private async append(chunk: string): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const size = await fs.stat(this.file).then((s) => s.size, () => 0);
      if (size > 0 && size + Buffer.byteLength(chunk) > this.max) await fs.rename(this.file, `${this.file}.1`);
      await fs.appendFile(this.file, chunk);
    } catch (err) {
      if (this.reported) return;
      this.reported = true;
      console.error("Could not write backend.log", err);
    }
  }
}
