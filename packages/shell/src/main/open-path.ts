import { promises as fs } from "node:fs";
import path from "node:path";
import { canOpenFile } from "@humanharness/protocol";

/**
 * The real path of `rel` inside one of `roots` (tried in order): a regular file, symlinks resolved, that
 * `accept` takes. Null when it is missing, escapes every root, or isn't accepted.
 */
async function fileInside(rel: unknown, roots: string[], accept: (real: string) => boolean): Promise<string | null> {
  if (typeof rel !== "string" || !rel || rel.length > 1000 || rel.includes("\0")) return null;
  for (const root of roots) {
    let realRoot: string;
    let real: string;
    try {
      realRoot = await fs.realpath(root);
      real = await fs.realpath(path.resolve(realRoot, rel));
    } catch {
      continue;
    }
    if (!real.startsWith(realRoot + path.sep)) continue;
    if (!accept(real)) continue;
    const stat = await fs.stat(real).catch(() => null);
    if (stat?.isFile()) return real;
  }
  return null;
}

/** Where Open and Show in Finder look for a file, in order: the user's folder first, then the reference folders. */
export function openRoots(folder: string, references: string[]): string[] {
  return [folder, ...references];
}

/** A file "Open" may hand to the system (an openable extension, see `canOpenFile`) inside one of `roots`. */
export function openableFile(rel: unknown, roots: string[]): Promise<string | null> {
  return fileInside(rel, roots, canOpenFile);
}

/** Any regular file inside one of `roots`: "Show in Finder" only reveals it, so its kind doesn't matter. */
export function revealableFile(rel: unknown, roots: string[]): Promise<string | null> {
  return fileInside(rel, roots, () => true);
}

/**
 * Whether `target` (from openableFile or revealableFile) is still a regular file, not a link, with no link
 * on its way (its real path is itself), inside one of `roots`: it or a folder above it may have been
 * swapped since it was checked.
 */
export async function stillSafe(target: string, roots: string[]): Promise<boolean> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  const real = await fs.realpath(target).catch(() => null);
  if (real !== target) return false;
  const realRoots = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => null)));
  return realRoots.some((r) => r !== null && real.startsWith(r + path.sep));
}

/** Hands `target` to `open` (shell.openPath) only if it is still safe. `open` answers "" on success. */
export async function openIfStillSafe(target: string, roots: string[], open: (p: string) => Promise<string>): Promise<boolean> {
  if (!(await stillSafe(target, roots))) return false;
  return (await open(target)) === "";
}

/** Hands `target` to `reveal` (shell.showItemInFolder) only if it is still safe. */
export async function revealIfStillSafe(target: string, roots: string[], reveal: (p: string) => void): Promise<boolean> {
  if (!(await stillSafe(target, roots))) return false;
  reveal(target);
  return true;
}
