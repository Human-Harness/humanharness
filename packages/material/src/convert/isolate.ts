import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { devLauncher } from "@humanharness/blocks";
import { MaterialRefused } from "../blocks";
import { CONVERT_HEAP_MB, CONVERT_TIMEOUT_MS } from "../constants";
import type { ConvertSettings, Converted, MaterialType } from "../types";
import type { ConvertOptions, Measured } from "./index";

/** One file to convert or measure, as the worker gets it. */
export type ConvertJob =
  | { op: "convert"; type: MaterialType; data: Buffer; name: string; pageRange?: [number, number]; settings?: ConvertSettings }
  | { op: "measure"; type: MaterialType; data: Buffer; name: string };

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

const REASONS: readonly MaterialRefused["reason"][] = ["unreadable", "protected", "scanned", "too-big"];

/**
 * Converts or measures a file in a worker thread with a heap limit and a time limit, so a file that would exhaust the
 * heap, recurse too deep or spin forever is refused instead of taking the app down (pdfjs decodes images, zip and XML
 * parsers build big trees: files are untrusted). Always settles: the result, or a `MaterialRefused` — "too-big" for
 * the heap or the time limit, the converter's own reason, "unreadable" for anything else.
 */
export function convertInWorker<J extends ConvertJob>(job: J, o: WorkerOptions = {}): Promise<J extends { op: "measure" } ? Measured : Converted> {
  const entry = o.entry ?? new URL("./worker.ts", import.meta.url);
  // Built JavaScript needs no loader; the TypeScript source needs tsx.
  const execArgv = o.entry ? [] : devLauncher().args;
  return new Promise((resolve, reject) => {
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
      void worker.terminate().catch(() => undefined);
      settle();
    };
    const refuse = (reason: MaterialRefused["reason"]) => finish(() => reject(new MaterialRefused(reason)));
    const timer = setTimeout(() => refuse("too-big"), o.timeoutMs ?? CONVERT_TIMEOUT_MS);
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
  measure(type: MaterialType, buf: Buffer, name: string): Promise<Measured>;
}

/** A runner that sends every file to its own worker (`convertInWorker`) with these options. */
export function workerRunner(o: WorkerOptions = {}): ConvertRunner {
  return {
    convert: (type, data, opts) => convertInWorker({ op: "convert", type, data, ...opts }, o),
    measure: (type, data, name) => convertInWorker({ op: "measure", type, data, name }, o),
  };
}
