// The file timeline service over the app's documents calls (`ctx.app.documents`).
import type { CoreApp } from "@humanharness/mod-sdk/core";
import { loadReview } from "@humanharness/workspace";
import { type DiffRunner, workerDiff } from "./diff-runner";
import { type FileTimelineDeps, FileTimelineService } from "./file-timeline";

export function appFileTimeline(app: CoreApp["documents"]): FileTimelineService {
  // Made at the first diff: where the worker is matters only then.
  let worker: DiffRunner | undefined;
  return new FileTimelineService({
    base: async () => (await app.folder())?.base ?? null,
    history: () => app.history() as ReturnType<FileTimelineDeps["history"]>,
    actionLabel: (id) => app.actionLabel(id),
    approvals: async (base, doc) => (await loadReview(base, doc).catch(() => null))?.approvals ?? [],
    // `blocked` says why a write can't run: quitting, or turns held.
    busy: () => app.busy() || app.blocked() !== null,
    // The core alone writes a go-back: its guard comes with the person's yes (`ctx.app.history.restoreFile`).
    restore: () => Promise.reject(new Error("A go-back writes only through the core's guard")),
    // The core tells the app itself after a go-back that went through.
    restored: () => {},
    // Diffs run in a worker thread of their own: jsdiff's budget and the Markdown parse never block Electron main.
    diff: (file, before, after) => (worker ??= workerDiff({ entry: app.diffWorker() }))(file, before, after),
  });
}
