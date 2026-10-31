import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { devLauncher } from "@humanharness/blocks";
import { type BuildJob, type BuildMessage, build } from "./build";

/** Runs one build; `done` settles true when it finished, false when it failed or was stopped. Never throws. */
export type BuildRunner = (job: BuildJob, onMessage: (m: BuildMessage) => void) => { done: Promise<boolean>; stop(): void };

const SEARCH_WORKER_HEAP_MB = 1024;

/** In this thread (tests, and any caller without a worker). */
export const inProcessBuild = (): BuildRunner => (job, onMessage) => {
  let stopped = false;
  const done = build(job, (m) => {
    if (!stopped) onMessage(m);
  }).then(
    () => !stopped,
    (err: unknown) => {
      console.error("Could not build the search index", err instanceof Error ? err.message : "unknown error");
      return false;
    },
  );
  return { done, stop: () => void (stopped = true) };
};

/** In a worker thread (§4.3, like `workerDiff`). Default entry: the TypeScript source through tsx; the app passes its built file. */
export function workerBuild(o: { entry?: string; heapMb?: number } = {}): BuildRunner {
  const entry = o.entry ?? fileURLToPath(new URL("./worker.ts", import.meta.url));
  const execArgv = o.entry ? [] : devLauncher().args;
  return (job, onMessage) => {
    let worker: Worker;
    try {
      worker = new Worker(entry, { workerData: job, execArgv, resourceLimits: { maxOldGenerationSizeMb: o.heapMb ?? SEARCH_WORKER_HEAP_MB } });
    } catch (err) {
      console.error("Could not start the search worker", err);
      return { done: Promise.resolve(false), stop: () => {} };
    }
    let settled = false;
    // Hoisted so `stop()` settles `done` too: a stopped build resolves false at once, and no message is applied after it.
    let finish: (ok: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => {
      finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        void worker.terminate().catch(() => undefined);
        resolve(ok);
      };
      worker.on("message", (m: BuildMessage | { type: "end" } | { type: "failed" }) => {
        if (m?.type === "end") finish(true);
        else if (m?.type === "failed") finish(false);
        else if (!settled && m) onMessage(m);
      });
      worker.once("error", (err) => {
        console.error("The search worker crashed", err instanceof Error ? err.message : "unknown error");
        finish(false);
      });
      worker.once("exit", () => finish(false));
    });
    return { done, stop: () => finish(false) };
  };
}
