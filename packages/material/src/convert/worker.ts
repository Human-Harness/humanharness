// The converter's worker thread (convert/isolate.ts): one job from `workerData`, one reply, then the thread ends.
// The app bundles this file as its own entry (Task 14).
import { parentPort, workerData } from "node:worker_threads";
import { MaterialRefused } from "../blocks";
import { convertFile, measureFile } from "./index";
import type { ConvertJob, ConvertReply } from "./isolate";

async function run(job: ConvertJob) {
  // A Buffer arrives as a plain Uint8Array.
  const data = Buffer.from(job.data.buffer, job.data.byteOffset, job.data.byteLength);
  if (job.op === "measure") return measureFile(job.type, data, job.name);
  return convertFile(job.type, data, { name: job.name, ...(job.pageRange ? { pageRange: job.pageRange } : {}), ...(job.settings ? { settings: job.settings } : {}) });
}

run(workerData as ConvertJob).then(
  (value) => parentPort?.postMessage({ ok: true, value } satisfies ConvertReply),
  (err: unknown) => {
    if (!(err instanceof MaterialRefused)) console.error("Could not convert the material", err);
    parentPort?.postMessage({ ok: false, reason: err instanceof MaterialRefused ? err.reason : "unreadable" } satisfies ConvertReply);
  },
);
