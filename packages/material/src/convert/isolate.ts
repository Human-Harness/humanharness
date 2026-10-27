import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { devLauncher } from "@humanharness/blocks";
import { MaterialRefused } from "../blocks";
import { CONVERT_AT_ONCE, CONVERT_HEAP_MB, CONVERT_TIMEOUT_MS } from "../constants";
import type { ConvertSettings, Converted, MaterialType } from "../types";
import type { ConvertOptions, Measured } from "./index";

/** One file to convert or measure, as the worker gets it. */
export type ConvertJob =
  | { op: "convert"; type: MaterialType; data: Buffer; name: string; pageRange?: [number, number]; settings?: ConvertSettings; link?: boolean }
  | { op: "measure"; type: MaterialType; data: Buffer; name: string; link?: boolean };

/** The worker's answer: the result, or the reason it refused the file. */
export type ConvertReply = { ok: true; value: Converted | Measured } | { ok: false; reason: string };

export interface WorkerOptions {
  /**
   * The worker's script. Default: the TypeScript source (`convert/worker.ts`), run through tsx (development and
   * tests). The app passes its built entry, which runs with no extra Node flags.
   */
  entry?: string | URL;
  /** The worker's heap; a file that needs more is refused "too-big". */
  heapMb?: number;
  /** How long one job may take; past it the worker is stopped and the file refused "too-big". */
  timeoutMs?: number;
}

/**
 * A job stopped on purpose (`ConvertRunner.stop`: a profile switch, closeRuntime, quitting), not a refusal: the file
 * may be fine, and its source is converted again later.
 */
export class ConvertStopped extends Error {
  constructor() {
    super("The conversion was stopped");
    this.name = "ConvertStopped";
  }
}

const REASONS: readonly MaterialRefused["reason"][] = ["unreadable", "protected", "scanned", "too-big"];

/**
 * Converts or measures a file in a worker thread with a heap limit and a time limit, so a file that would exhaust the
 * heap, recurse too deep or spin forever is refused instead of taking the app down (pdfjs decodes images, zip and XML
 * parsers build big trees: files are untrusted). Always settles: the result, or a `MaterialRefused` — "too-big" for
 * the heap or the time limit, the converter's own reason, "unreadable" for anything else.
 */
export function convertInWorker<J extends ConvertJob>(
  job: J,
  o: WorkerOptions = {},
  signal?: AbortSignal,
): Promise<J extends { op: "measure" } ? Measured : Converted> {
  const entry = o.entry ?? new URL("./worker.ts", import.meta.url);
  // Built JavaScript needs no loader; the TypeScript source needs tsx.
  const execArgv = o.entry ? [] : devLauncher().args;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ConvertStopped());
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(entry instanceof URL ? fileURLToPath(entry) : entry, {
        workerData: job,
        execArgv,
        resourceLimits: { maxOldGenerationSizeMb: o.heapMb ?? CONVERT_HEAP_MB },
      });
    } catch (err) {
      console.error("Could not start the converter", err);
      reject(new MaterialRefused("unreadable"));
      return;
    }
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onStop);
      void worker.terminate().catch(() => undefined);
      settle();
    };
    const refuse = (reason: MaterialRefused["reason"]) => finish(() => reject(new MaterialRefused(reason)));
    const timer = setTimeout(() => refuse("too-big"), o.timeoutMs ?? CONVERT_TIMEOUT_MS);
    // A stop ends the worker at once; the job is neither a result nor a refusal.
    const onStop = () => finish(() => reject(new ConvertStopped()));
    signal?.addEventListener("abort", onStop, { once: true });
    worker.once("message", (m: ConvertReply) => {
      if (m && typeof m === "object" && m.ok === true) finish(() => resolve(m.value as J extends { op: "measure" } ? Measured : Converted));
      else refuse(m && typeof m === "object" && m.ok === false && REASONS.includes(m.reason as MaterialRefused["reason"]) ? (m.reason as MaterialRefused["reason"]) : "unreadable");
    });
    worker.once("error", (err: Error & { code?: string }) => {
      if (err.code === "ERR_WORKER_OUT_OF_MEMORY") return refuse("too-big");
      console.error("The converter crashed", err);
      refuse("unreadable");
    });
    // Exiting without an answer (process.exit, a native crash) reads as unreadable.
    worker.once("exit", () => refuse("unreadable"));
  });
}

/** Converting and measuring, wherever they run. */
export interface ConvertRunner {
  convert(type: MaterialType, buf: Buffer, opts: ConvertOptions): Promise<Converted>;
  measure(type: MaterialType, buf: Buffer, name: string, link?: boolean): Promise<Measured>;
  /** Stops every job running or waiting now: each rejects with `ConvertStopped`. Jobs asked for later run as usual. */
  stop?(): void;
}

/** A runner that sends every file to its own worker (`convertInWorker`) with these options. */
export function workerRunner(o: WorkerOptions = {}): ConvertRunner {
  // The jobs started since the last stop share one signal.
  let stopper = new AbortController();
  return {
    convert: (type, data, opts) => convertInWorker({ op: "convert", type, data, ...opts }, o, stopper.signal),
    measure: (type, data, name, link) => convertInWorker({ op: "measure", type, data, name, ...(link ? { link } : {}) }, o, stopper.signal),
    stop: () => {
      stopper.abort();
      stopper = new AbortController();
    },
  };
}

/**
 * A runner that lets at most `n` jobs run at once; the others wait their turn, in order. The app shares one, so many
 * files added together never start many workers (each may take CONVERT_HEAP_MB).
 */
export function limitRunner(inner: ConvertRunner, n = CONVERT_AT_ONCE): ConvertRunner {
  let running = 0;
  const waiting: (() => void)[] = [];
  // Bumped by a stop: a job that waited since before it never starts.
  let generation = 0;
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    const asked = generation;
    if (running >= n) await new Promise<void>((r) => waiting.push(r));
    else running++;
    try {
      if (asked !== generation) throw new ConvertStopped();
      return await job();
    } finally {
      // The place passes straight to the next job waiting; otherwise it frees up.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
  return {
    convert: (type, data, opts) => slot(() => inner.convert(type, data, opts)),
    measure: (type, data, name, link) => slot(() => inner.measure(type, data, name, link)),
    stop: () => {
      generation++;
      inner.stop?.();
    },
  };
}
