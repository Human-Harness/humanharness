// A worker that answers with a reason no converter gives, or throws, by the job's name.
import { parentPort, workerData } from "node:worker_threads";

if (workerData.name === "throw") throw new Error("boom");
parentPort.postMessage({ ok: false, reason: "constructor" });
