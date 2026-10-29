import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Launcher } from "@humanharness/blocks";
import {
  BACKEND_CALL_TIMEOUT_MS,
  BACKEND_CALLS_IN_FLIGHT,
  BACKEND_EVENTS_PER_SECOND,
  BACKEND_LINE_MAX,
  BACKEND_STOP_GRACE_MS,
  type BackendInit,
} from "@humanharness/harness-sdk";
import type { BackendLog } from "./backend-log";
import { EventLimiter, LineReader, classifyIncoming, encode, refusalFor } from "./backend-protocol";

export interface BackendProcessOptions {
  launcher: Launcher;
  /** The backend entry, absolute (resolveInHarness). Its real path must stay inside `cwd`. */
  entry: string;
  /** The harness folder. */
  cwd: string;
  init: BackendInit;
  log: Pick<BackendLog, "write">;
  onEvent: (event: string, data: unknown) => void;
  timeoutMs?: number;
  graceMs?: number;
  now?: () => number;
}

export interface BackendExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True when stop() asked for it. */
  expected: boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const NOT_RUNNING = "The backend isn't running";
/** How often dropped events are reported to the log (spec decision 11). */
const DROP_REPORT_MS = 1000;
/** After `exit`, how long to wait for stdout to close before treating the process as gone anyway. */
const CLOSE_FALLBACK_MS = 500;

/** The entry's real path, refused unless it lies inside the harness folder's real path (B1: no symlink out). */
async function realEntry(entry: string, cwd: string): Promise<string> {
  const [root, file] = await Promise.all([fs.realpath(cwd), fs.realpath(entry)]);
  const rel = path.relative(root, file);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error("The backend's entry is outside the harness folder");
  }
  return file;
}

/**
 * One harness backend process (hatches spec §4.2, §4.3; threat model B1, B3, B4, B5, B7, B8). A separate child on the
 * harness's launcher, with the harness folder as cwd; stdin/stdout carry newline-delimited JSON-RPC 2.0, stderr only
 * goes to the log. The app sends `init` first, then calls and notifications; the backend may only answer our calls
 * and send events (rate limited). Anything it asks is refused with -32601 and logged. It never restarts itself: the
 * supervisor does that, watching `exited`.
 */
export class BackendProcess {
  /** Resolves once the process is gone: `expected` when stop() asked for it. */
  readonly exited: Promise<BackendExit>;

  private readonly pending = new Map<number, Pending>();
  private readonly limiter: EventLimiter;
  private readonly dropTimer: NodeJS.Timeout;
  private nextId = 1;
  private gone = false;
  private expected = false;
  private stopping: Promise<void> | null = null;
  private resolveExited!: (exit: BackendExit) => void;

  private constructor(
    private readonly child: ChildProcess,
    private readonly o: BackendProcessOptions,
  ) {
    this.limiter = new EventLimiter(BACKEND_EVENTS_PER_SECOND, o.now);
    this.exited = new Promise((resolve) => {
      this.resolveExited = resolve;
    });
    this.dropTimer = setInterval(() => this.reportDropped(), DROP_REPORT_MS);
    this.dropTimer.unref();
    this.wire();
  }

  static async start(o: BackendProcessOptions): Promise<BackendProcess> {
    const entry = await realEntry(o.entry, o.cwd);
    const child = spawn(o.launcher.command, [...o.launcher.args, entry], {
      cwd: o.cwd,
      env: { ...process.env, ...o.launcher.env },
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group on POSIX, so stop() reaches whatever it starts too.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const p = new BackendProcess(child, o);
    p.write(encode({ method: "init", params: o.init }));
    return p;
  }

  /** Calls `method` on the backend; rejects with its error message, on timeout, or when it isn't running. */
  call(method: string, params: unknown): Promise<unknown> {
    if (this.gone || this.expected) return Promise.reject(new Error(NOT_RUNNING));
    if (this.pending.size >= BACKEND_CALLS_IN_FLIGHT) return Promise.reject(new Error("Too many calls to the backend"));
    const id = this.nextId++;
    let line: string;
    try {
      line = encode({ id, method, params });
    } catch {
      return Promise.reject(new Error("The call's params can't be sent to the backend"));
    }
    if (Buffer.byteLength(line) > BACKEND_LINE_MAX) return Promise.reject(new Error("The call is too large for the backend"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The backend didn't answer in time"));
      }, this.o.timeoutMs ?? BACKEND_CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write(line);
    });
  }

  /** Tells the backend the scopes changed (part 1's links included). */
  notify(method: "scopesChanged", params: BackendInit): void {
    if (this.gone || this.expected) return;
    this.write(encode({ method, params }));
  }

  /** SIGTERM to its process group, SIGKILL after the grace period; resolves once it's gone. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.expected = true;
    this.stopping = (async () => {
      if (this.gone) return;
      this.signal("SIGTERM");
      const kill = setTimeout(() => this.signal("SIGKILL"), this.o.graceMs ?? BACKEND_STOP_GRACE_MS);
      await this.exited;
      clearTimeout(kill);
    })();
    return this.stopping;
  }

  private signal(sig: NodeJS.Signals): void {
    const pid = this.child.pid;
    try {
      if (process.platform !== "win32" && pid !== undefined) process.kill(-pid, sig);
      else this.child.kill(sig);
    } catch {
      // Already gone.
    }
  }

  private write(line: string): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(line);
  }

  private note(text: string): void {
    void this.o.log.write("app", text);
  }

  private reportDropped(): void {
    const n = this.limiter.flushDropped();
    if (n > 0) this.note(`Dropped ${n} backend events`);
  }

  private onLine(line: string): void {
    // Once gone (the fallback after exit), a grandchild still holding stdout is not heard.
    if (this.gone) return;
    const msg = classifyIncoming(line, new Set(this.pending.keys()));
    switch (msg.kind) {
      case "response": {
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        clearTimeout(call.timer);
        if (msg.error !== undefined) call.reject(new Error(msg.error));
        else call.resolve(msg.result);
        return;
      }
      case "event":
        // Once stop is asked, the backend's last words aren't passed on (a new one may already be starting).
        if (this.expected || !this.limiter.take()) return;
        try {
          this.o.onEvent(msg.event, msg.data);
        } catch (e) {
          // A failing listener must not escape the stdout handler into main.
          this.note(`The app couldn't handle the backend event ${msg.event}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      case "request":
        this.write(refusalFor(msg.id));
        this.note(`A backend asked the app for ${msg.method}; refused`);
        return;
      case "invalid":
        // An invalid request (an id that can't be echoed) lands here too: logged only, never answered.
        this.note(`Dropped a line from the backend: ${describeInvalid(msg.why)}`);
    }
  }

  private wire(): void {
    const { child } = this;
    const out = new LineReader(
      (line) => this.onLine(line),
      (bytes) => this.note(`Dropped a line from the backend: ${bytes} bytes, over 1 MB`),
    );
    const err = new LineReader(
      (line) => void this.o.log.write("stderr", line),
      (bytes) => this.note(`Dropped a stderr line from the backend: ${bytes} bytes, over 1 MB`),
    );
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stdout?.on("end", () => out.flush());
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    child.stderr?.on("end", () => err.flush());
    // A backend that closes its stdin early must not crash the app with EPIPE.
    child.stdin?.on("error", () => {});
    child.on("error", (e) => this.note(`The backend process failed: ${e.message}`));

    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    const finish = () => {
      if (this.gone || !exit) return;
      this.gone = true;
      clearInterval(this.dropTimer);
      this.reportDropped();
      for (const call of this.pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error(NOT_RUNNING));
      }
      this.pending.clear();
      this.resolveExited({ ...exit, expected: this.expected });
    };
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      // Normally `close` follows once stdout and stderr are drained; a grandchild holding them open can't hold us.
      setTimeout(finish, CLOSE_FALLBACK_MS).unref();
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      exit ??= { code, signal };
      finish();
    });
  }
}

/** The log's words for an invalid line; a line without "jsonrpc" gets a hint, as every answer then goes missing. */
function describeInvalid(why: string): string {
  if (why === "not JSON-RPC 2.0") return `${why} (every line needs "jsonrpc":"2.0")`;
  if (why === "a response to a call the app didn't make") return `${why} (or one that timed out)`;
  return why;
}
