// The diff's worker thread (diff-runner.ts): one diff from `workerData`, one reply, then the thread ends. The app bundles
// this file as its own entry (`diff-worker`), so a diff's jsdiff budget and Markdown parse never block Electron main.
import { parentPort, workerData } from "node:worker_threads";
import { type DiffSide, diffFile } from "@humanharness/workspace";
import type { DiffJob, DiffReply } from "./diff-runner";

// A Buffer arrives as a plain Uint8Array, which `diffFile` takes as it is.
const { file, before, after, budgetMs } = workerData as DiffJob;
let reply: DiffReply;
try {
  reply = { ok: true, view: diffFile(file, before as DiffSide, after as DiffSide, budgetMs) };
} catch (err) {
  console.error("Could not compute the diff", err);
  reply = { ok: false };
}
parentPort?.postMessage(reply);
