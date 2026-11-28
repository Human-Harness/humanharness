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
