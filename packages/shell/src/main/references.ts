import { promises as fs } from "node:fs";
import path from "node:path";
import type { HarnessReference, LocalizedText } from "@humanharness/harness-sdk";
import { folderProblem, realFolder } from "./validate";

export interface ResolvedReference {
  id: string;
  label: LocalizedText;
  /** Absolute real path. */
  path: string;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** The repository the app runs from: the nearest folder above the harness with a pnpm-workspace.yaml. */
export async function appSourceDir(harnessDir: string): Promise<string | null> {
  let dir = path.resolve(harnessDir);
  for (;;) {
    if (await exists(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether the agent may read `dir`: never credentials (~/.claude, ~/.codex), ~/Library, system folders,
 * the whole home or a standard home folder as a whole. A comma would break Claude's tool lists.
 */
export function referenceAllowed(dir: string, home: string): boolean {
  return !dir.includes(",") && folderProblem(dir, home) === null;
}

/** "~/…" for a path inside the home folder. */
export function displayPath(p: string, home: string): string {
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

/** The manifest's reference folders that exist and may be read; "app-source" only in development. */
export async function resolveReferences(
  refs: HarnessReference[],
  opts: { harnessDir: string; home: string; packaged: boolean; allowed?: (dir: string) => boolean },
): Promise<ResolvedReference[]> {
  const allowed = opts.allowed ?? ((dir: string) => referenceAllowed(dir, opts.home));
  const out: ResolvedReference[] = [];
  for (const r of refs) {
    let dir: string | null;
    if (r.default === "app-source") dir = opts.packaged ? null : await appSourceDir(opts.harnessDir);
    else dir = r.default.startsWith("~/") ? path.join(opts.home, r.default.slice(2)) : r.default;
    if (!dir || !path.isAbsolute(dir)) continue;
    try {
      const real = await fs.realpath(dir);
      if ((await fs.stat(real)).isDirectory() && allowed(real)) out.push({ id: r.id, label: r.label, path: real });
    } catch {
      // missing: left out
    }
  }
  return out;
}

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side.
const norm = (p: string) => path.resolve(p).toLowerCase();

/**
 * The references that may be used with the working folder `folder`. A reference that is the working
 * folder or contains it is refused (`refused` gets why): its read-only rules would stop the agent from
 * changing the person's files.
 */
export async function usableReferences(
  refs: ResolvedReference[],
  folder: string,
  refused: (message: string) => void = () => {},
): Promise<ResolvedReference[]> {
  let real: string;
  try {
    real = await realFolder(folder);
  } catch {
    real = path.resolve(folder);
  }
  const f = norm(real);
  return refs.filter((r) => {
    const ref = norm(r.path);
    if (f !== ref && !f.startsWith(ref + path.sep)) return true;
    refused(`The reference folder "${r.id}" (${r.path}) contains the working folder ${real}: it is left out, so the agent can still change your files.`);
    return false;
  });
}
