import type { BrokerAnswer } from "./plugin-broker";
import { type PluginRpc, parsePluginRpc } from "./plugin-protocol";

export type BackendCommand = { kind: "run"; runId: string; source: string } | { kind: "idle" };

interface Pending {
  resolve(): void;
  reject(err: Error): void;
}

const STOPPED = "The plugin's backend stopped";

/**
 * Main's end of one backend window's `rpc` (Decision 10): the core host script pulls commands with `next`, reports
 * runs with `done`, and makes `ctx` calls that go to the broker. One channel per backend window: a restarted window
 * gets a new one (so does a reloaded page: the old page's waiting `next` must not swallow a run), and a closed channel
 * answers nothing. Runs go only to a `next` after a successful `ready`. Every argument is checked (parsePluginRpc's
 * shapes); an unknown method or a malformed argument throws.
 */
export class PluginChannel {
  private readonly queue: BackendCommand[] = [];
  private readonly waiting: ((c: BackendCommand) => void)[] = [];
  /** Runs handed out or queued, by run id: settled by `done`, or rejected by `fail`/`close`. */
  private readonly runs = new Map<string, Pending>();
  private readonly readyPromise: Promise<{ sources: string[] }>;
  private settleReady!: { resolve(v: { sources: string[] }): void; reject(e: Error): void };
  private closed = false;
  /** Set by a successful `ready`: only a page that loaded its backend pulls runs. */
  private loaded = false;

  constructor(private readonly d: { ctx(runId: string, name: string, args: unknown[]): Promise<BrokerAnswer>; idleMs: number }) {
    this.readyPromise = new Promise((resolve, reject) => (this.settleReady = { resolve, reject }));
    this.readyPromise.catch(() => {});
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Resolves when the backend loaded (with the sources it defines); rejects with its load error or when closed. */
  ready(): Promise<{ sources: string[] }> {
    return this.readyPromise;
  }

  /** Queues a run of `source` under `runId`; settles when the backend reports it done. */
  run(runId: string, source: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error(STOPPED));
    const done = new Promise<void>((resolve, reject) => this.runs.set(runId, { resolve, reject }));
    const cmd: BackendCommand = { kind: "run", runId, source };
    const waiter = this.waiting.shift();
    if (waiter) waiter(cmd);
    else this.queue.push(cmd);
    return done;
  }

  /** Fails one run (over the run limit): its promise rejects; a later `done` for it is ignored. */
  fail(runId: string, reason: string): void {
    const p = this.runs.get(runId);
    if (!p) return;
    this.runs.delete(runId);
    const i = this.queue.findIndex((c) => c.kind === "run" && c.runId === runId);
    if (i >= 0) this.queue.splice(i, 1);
    p.reject(new Error(reason));
  }

  /** An rpc as it arrives from the preload (method, parsed payload): checked, then dispatched. */
  async handle(method: unknown, args: unknown): Promise<unknown> {
    const rpc = parsePluginRpc(method, JSON.stringify(args ?? null));
    if (rpc === null) throw new Error(`Unknown or malformed rpc ${typeof method === "string" ? method.slice(0, 40) : typeof method}`);
    return this.dispatch(rpc);
  }

  /** An rpc already checked by parsePluginRpc (the host's path: the payload is parsed once). */
  async dispatch(rpc: PluginRpc): Promise<unknown> {
    if (this.closed) throw new Error(STOPPED);
    switch (rpc.method) {
      case "ready":
        if ("error" in rpc) this.settleReady.reject(new Error(rpc.error));
        else {
          this.loaded = true;
          this.settleReady.resolve({ sources: rpc.sources });
        }
        return null;
      case "next":
        if (!this.loaded) throw new Error("The backend is not ready");
        return this.next();
      case "done": {
        const p = this.runs.get(rpc.runId);
        if (p) {
          this.runs.delete(rpc.runId);
          if (rpc.ok) p.resolve();
          else p.reject(new Error(rpc.error || "The sync failed"));
        }
        return null;
      }
      case "ctx":
        return this.d.ctx(rpc.runId, rpc.name, rpc.args);
    }
  }

  /** The window went: every pending run rejects, a waiting `next` answers idle, and nothing is answered after. */
  close(reason = STOPPED): void {
    if (this.closed) return;
    this.closed = true;
    this.settleReady.reject(new Error(reason));
    for (const p of this.runs.values()) p.reject(new Error(reason));
    this.runs.clear();
    this.queue.length = 0;
    for (const w of this.waiting.splice(0)) w({ kind: "idle" });
  }

  private next(): Promise<BackendCommand> {
    const cmd = this.queue.shift();
    if (cmd) return Promise.resolve(cmd);
    return new Promise((resolve) => {
      const waiter = (c: BackendCommand) => {
        clearTimeout(timer);
        resolve(c);
      };
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) this.waiting.splice(i, 1);
        resolve({ kind: "idle" });
      }, this.d.idleMs);
      this.waiting.push(waiter);
    });
  }
}
