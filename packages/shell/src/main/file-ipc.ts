import type { AppConfig, ConfiguredApp } from "@humanharness/protocol";
import type { InvokeChannel } from "@humanharness/protocol/channels";
import type { FileTimelineService } from "./file-timeline";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import type { ResolvedReference } from "./references";

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

export interface OpenPathIpcDeps {
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  workReferences(c: AppConfig, base: string): Promise<ResolvedReference[]>;
  shell: { openPath(p: string): Promise<string>; showItemInFolder(p: string): void };
}

/** Opens a file, or shows it in Finder, inside the folder or a reference folder (`hh:openPath`, `hh:revealPath`). */
export function openPathIpc(d: OpenPathIpcDeps) {
  const { validConfig, baseOf, workReferences, shell } = d;
  return {
    "hh:openPath": async (file: unknown) => {
      const c = await validConfig();
      if (!c) return false;
      const roots = openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
      const target = await openableFile(file, roots);
      if (!target) return false;
      // Checked again right before opening: the file or a folder above it may have been swapped for a link meanwhile.
      return openIfStillSafe(target, roots, (p) => shell.openPath(p));
    },
    // Shows a file in Finder (it never opens it): any kind of file, with the same checks as hh:openPath.
    "hh:revealPath": async (file: unknown) => {
      const c = await validConfig();
      if (!c) return false;
      const roots = openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
      const target = await revealableFile(file, roots);
      if (!target) return false;
      return revealIfStillSafe(target, roots, (p) => shell.showItemInFolder(p));
    },
  };
}
