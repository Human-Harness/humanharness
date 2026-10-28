import type { FileTimelineService } from "./file-timeline";

/** The most paths one `hh:fileCommits` lists; a commit that changed more (a big Start) sends null: "refresh them all". */
export const MAX_ANNOUNCED_PATHS = 200;

/** What `hh:fileCommits` sends for a commit's paths. */
export const announcedPaths = (paths: string[]): string[] | null => (paths.length > MAX_ANNOUNCED_PATHS ? null : paths);

export const FILE_CHANNELS = ["hh:fileTimeline", "hh:fileDiff", "hh:fileRestorePrompt", "hh:fileRestore"] as const;
export type FileChannel = (typeof FILE_CHANNELS)[number];

const failed = { ok: false as const, reason: "failed" as const };

/** The `hh:file*` handlers (file-timeline spec §6.3). Every answer is data; a throw is a bug, logged, answered `failed`. */
export function fileHandlers(svc: FileTimelineService): Record<FileChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A file timeline call failed", err);
        return failed;
      });
  return {
    "hh:fileTimeline": (file) => call(() => svc.timeline(file)),
    "hh:fileDiff": (file, from, to) => call(() => svc.diff(file, from, to)),
    "hh:fileRestorePrompt": (file, commit) => call(() => svc.restorePrompt(file, commit)),
    "hh:fileRestore": (file, commit) => call(() => svc.restore(file, commit)),
  };
}
