import { promises as fs } from "node:fs";
import path from "node:path";
import type { HarnessReference } from "@humanharness/harness-sdk";
import { folderProblem, realFolder } from "./validate";

export interface ResolvedReference {
  id: string;
  label: string;
  /** Absolute real path. */
  path: string;
}

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side.
const norm = (p: string) => path.resolve(p).toLowerCase();

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
 * Whether the agent may read `dir` (a real path; `home` real too): never a dot-folder directly in the home
 * folder or anything inside one (~/.claude, ~/.codex, ~/.gemini, ~/.ssh, ~/.aws, ~/.config...), ~/Library,
 * system folders, the whole home or a standard home folder as a whole. A comma would break Claude's tool lists.
 */
export function referenceAllowed(dir: string, home: string): boolean {
  return !dir.includes(",") && folderProblem(dir, home) === null && !homeOrDotFolder(dir, home);
}

/** Whether `dir` is the home folder, a dot-folder directly in it, or inside one. Without case. */
export function homeOrDotFolder(dir: string, home: string): boolean {
  const rel = path.relative(norm(home), norm(dir));
  if (rel === "") return true;
  const first = rel.split(path.sep)[0];
  // Outside the home folder: not this rule's concern.
  if (first === ".." || path.isAbsolute(rel)) return false;
  return first.startsWith(".");
}

/** "~/…" for a path inside the home folder. */
export function displayPath(p: string, home: string): string {
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

/** The manifest's reference folders that exist and may be read; "app-source" only in development. */
export async function resolveReferences(
  refs: HarnessReference[],
  opts: { harnessDir: string; home: string; packaged: boolean; allowed?: (dir: string, home: string) => boolean },
): Promise<ResolvedReference[]> {
  // Compared as real paths: a home reached through a link still guards its dot-folders.
  const home = await fs.realpath(opts.home).catch(() => opts.home);
  const allowed = opts.allowed ?? referenceAllowed;
  const out: ResolvedReference[] = [];
  for (const r of refs) {
    let dir: string | null;
    if (r.default === "app-source") dir = opts.packaged ? null : await appSourceDir(opts.harnessDir);
    else dir = r.default.startsWith("~/") ? path.join(opts.home, r.default.slice(2)) : r.default;
    if (!dir || !path.isAbsolute(dir)) continue;
    try {
      const real = await fs.realpath(dir);
      if ((await fs.stat(real)).isDirectory() && allowed(real, home)) out.push({ id: r.id, label: r.label, path: real });
    } catch {
      // missing: left out
    }
  }
  return out;
}

/**
 * The references that may be used with the working folder `folder`. A reference that is the working
 * folder or contains it is refused (`refused` gets why): its read-only rules would stop the agent from
 * changing the person's files. With profiles, `root` is the app's folder: a reference inside it (another profile's
 * folder) is refused too, so one person's work never reaches another's agent. Without `root`, as before.
 */
export async function usableReferences(
  refs: ResolvedReference[],
  folder: string,
  refused: (message: string) => void = () => {},
  root?: string,
): Promise<ResolvedReference[]> {
  const real = await realOr(folder);
  const f = norm(real);
  const realRoot = root === undefined ? null : await realOr(root);
  const r0 = realRoot === null ? null : norm(realRoot);
  return refs.filter((r) => {
    const ref = norm(r.path);
    if (f === ref || f.startsWith(ref + path.sep)) {
      refused(`The reference folder "${r.id}" (${r.path}) contains the working folder ${real}: it is left out, so the agent can still change your files.`);
      return false;
    }
    if (r0 !== null && ref.startsWith(r0 + path.sep)) {
      refused(`The reference folder "${r.id}" (${r.path}) is inside the app's folder ${realRoot}: it is left out, so one person never reads another's work.`);
      return false;
    }
    return true;
  });
}

async function realOr(folder: string): Promise<string> {
  try {
    return await realFolder(folder);
  } catch {
    return path.resolve(folder);
  }
}
