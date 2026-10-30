import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { FileTimelineService } from "./file-timeline";

/** The most paths one `hh:fileCommits` lists; a commit that changed more (a big Start) sends null: "refresh them all". */
export const MAX_ANNOUNCED_PATHS = 200;

/** What `hh:fileCommits` sends for a commit's paths. */
export const announcedPaths = (paths: string[]): string[] | null => (paths.length > MAX_ANNOUNCED_PATHS ? null : paths);

type CommitSource = { onCommit(listener: (c: { paths: string[] }) => void): () => void };

/**
 * Sends each watched history's commits to the window (`send` gets `announcedPaths`). `stop` unsubscribes one history,
 * e.g. when its runtime closes, so a closed runtime's history stays no listener of main's.
 */
export function commitAnnouncer(send: (paths: string[] | null) => void) {
  const stops = new Map<CommitSource, () => void>();
  return {
    watch(history: CommitSource): void {
      stops.get(history)?.();
      stops.set(
        history,
        history.onCommit((c) => send(announcedPaths(c.paths))),
      );
    },
    stop(history: CommitSource): void {
      stops.get(history)?.();
      stops.delete(history);
    },
  };
}

export const FILE_CHANNELS = ["hh:fileTimeline", "hh:fileDiff"] as const satisfies readonly InvokeChannel[];
export type FileChannel = (typeof FILE_CHANNELS)[number];

const failed = { ok: false as const, reason: "failed" as const };

/**
 * The `hh:file*` read handlers (file-timeline spec §6.3; the go-back, `hh:fileRestore`, is in go-back.ts). Every
 * answer is data; a throw is a bug, logged, answered `failed`.
 */
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
  };
}
