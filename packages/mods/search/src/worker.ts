// The search build's worker thread (runner.ts): one job from `workerData`, its messages, then "end" (or "failed"). The
// app bundles this file as its own entry (`search-worker`), so reading a large folder never blocks Electron main.
import { parentPort, workerData } from "node:worker_threads";
import { type BuildJob, build } from "./build";

build(workerData as BuildJob, (m) => parentPort?.postMessage(m)).then(
  () => parentPort?.postMessage({ type: "end" }),
  (err: unknown) => {
    console.error("Could not build the search index", err instanceof Error ? err.message : "unknown error");
    parentPort?.postMessage({ type: "failed" });
  },
);
