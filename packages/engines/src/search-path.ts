import fs from "node:fs";
import path from "node:path";

/** Where a preset turn's PATH falls back when no entry is left: an empty PATH would search the current folder. */
export const FALLBACK_SEARCH_PATH = "/usr/bin:/bin";

/**
 * `p`'s real path, spelled as on disk; for a path that doesn't exist (yet), its deepest existing folder's real path
 * with the rest appended. Compared without case and Unicode form below, so a folder created later can't slip by.
 */
function placed(p: string): string {
  let head = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...rest.reverse());
    } catch {
      const up = path.dirname(head);
      if (up === head) return path.resolve(p);
      rest.push(path.basename(head));
      head = up;
    }
  }
}

const fold = (p: string) => p.normalize("NFC").toLowerCase();

/**
 * A preset turn's `PATH`: the absolute entries that lie outside every root (the work folder and the scope's linked
 * folders), each placed by its real path. An empty, `.` or relative entry would search the current folder, and one
 * inside a root a folder the agent writes: either could answer for `node`, `npx`'s `#!/usr/bin/env node` or a hook's
 * interpreter (hatches spec §5.3, E2). When nothing is left, `/usr/bin:/bin`. Applied on turns with an engine preset
 * only: without one the environment stays as it was (D0).
 */
export function absoluteSearchPath(value: string, roots: readonly string[] = []): string {
  const rootsAt = roots.map((r) => fold(placed(r)));
  const kept = value.split(":").filter((d) => {
    if (!d.startsWith("/")) return false;
    const at = fold(placed(d));
    return !rootsAt.some((r) => at === r || at.startsWith(r.endsWith("/") ? r : `${r}/`));
  });
  return kept.length > 0 ? kept.join(":") : FALLBACK_SEARCH_PATH;
}
