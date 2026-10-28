import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { devLauncher } from "@humanharness/blocks";
import { DIFF_TIMEOUT_MS, type DiffSide, type FileDiffView, diffFile } from "@humanharness/workspace";

/** One diff, as the worker gets it. */
export interface DiffJob {
  file: string;
  before: DiffSide;
  after: DiffSide;
  budgetMs: number;
}
export type DiffReply = { ok: true; view: FileDiffView } | { ok: false };

/** Computes a file's diff somewhere; null when it could not (a crash, the heap or the time limit). */
export type DiffRunner = (file: string, before: DiffSide, after: DiffSide) => Promise<FileDiffView | null>;

/**
 * The budget of a diff run on the calling thread. jsdiff blocks for up to its budget and the Markdown parse comes on
 * top, so on Electron main (the fallback when no worker entry is given) it stays small: what doesn't fit shows as
 * removed, then added.
 */
export const IN_PROCESS_DIFF_MS = 250;
/** How long a worker may take in all (start, parse, the jsdiff budget) before it is stopped. */
export const DIFF_WORKER_TIMEOUT_MS = 15_000;
const DIFF_WORKER_HEAP_MB = 512;

/** Runs the diff here, with a small budget (tests, and any caller without a worker). */
export const inProcessDiff =
  (budgetMs = IN_PROCESS_DIFF_MS): DiffRunner =>
  async (file, before, after) =>
    diffFile(file, before, after, budgetMs);

export interface DiffWorkerOptions {
  /** The worker's script. Default: the TypeScript source, run through tsx (development and tests). The app passes its built entry. */
  entry?: string;
  /** The jsdiff budget inside the worker. */
  budgetMs?: number;
  timeoutMs?: number;
  heapMb?: number;
}

/**
 * Runs each diff in its own worker thread (file-timeline spec §4; like the material converter's `convertInWorker`), so
 * the jsdiff budget (`DIFF_TIMEOUT_MS`, synchronous) and the Markdown parse never freeze the window. Always settles:
 * the view, or null when the worker failed, ran out of heap or time.
 */
export function workerDiff(o: DiffWorkerOptions = {}): DiffRunner {
  const entry = o.entry ?? fileURLToPath(new URL("./diff-worker.ts", import.meta.url));
  // Built JavaScript needs no loader; the TypeScript source needs tsx.
  const execArgv = o.entry ? [] : devLauncher().args;
  return (file, before, after) =>
    new Promise((resolve) => {
      const job: DiffJob = { file, before, after, budgetMs: o.budgetMs ?? DIFF_TIMEOUT_MS };
      let worker: Worker;
      try {
        worker = new Worker(entry, { workerData: job, execArgv, resourceLimits: { maxOldGenerationSizeMb: o.heapMb ?? DIFF_WORKER_HEAP_MB } });
      } catch (err) {
        console.error("Could not start the diff worker", err);
        resolve(null);
        return;
      }
      let done = false;
      const finish = (view: FileDiffView | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate().catch(() => undefined);
        resolve(view);
      };
      const timer = setTimeout(() => finish(null), o.timeoutMs ?? DIFF_WORKER_TIMEOUT_MS);
      worker.once("message", (m: DiffReply) => finish(m && typeof m === "object" && m.ok === true ? m.view : null));
      worker.once("error", (err) => {
        console.error("The diff worker crashed", err);
        finish(null);
      });
      // Exiting without an answer reads as a failure.
      worker.once("exit", () => finish(null));
    });
}
