/**
 * `client.files.onChange` (file-timeline spec §6): one `hh:fileCommits` listener on the ipc channel for every file
 * watched, however many views watch; each file's listeners hear only the commits that touched it. Main sends null for
 * a commit that changed too many files to list: then every listener hears it.
 */
export function fileCommitListeners(subscribe: (listener: (paths: unknown) => void) => () => void) {
  const byFile = new Map<string, Set<() => void>>();
  let off: (() => void) | null = null;
  const tell = (listeners: Iterable<() => void>) => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch (err) {
        console.error("A file change listener failed", err);
      }
    }
  };
  const dispatch = (paths: unknown) => {
    if (paths === null) return tell([...byFile.values()].flatMap((s) => [...s]));
    if (!Array.isArray(paths)) return;
    for (const p of new Set(paths)) {
      const listeners = typeof p === "string" ? byFile.get(p) : undefined;
      if (listeners) tell(listeners);
    }
  };
  return {
    onChange(file: string, listener: () => void): () => void {
      let set = byFile.get(file);
      if (!set) byFile.set(file, (set = new Set()));
      set.add(listener);
      off ??= subscribe(dispatch);
      return () => {
        set.delete(listener);
        if (set.size === 0 && byFile.get(file) === set) byFile.delete(file);
        if (byFile.size === 0 && off) {
          off();
          off = null;
        }
      };
    },
  };
}
