import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Files "Open" may hand to the system: text, data and images. Never apps, scripts or installers
 * (`.app`, `.command`, `.sh`, `.pkg`…), which the system would run instead of showing, nor pages,
 * SVGs and JavaScript or TypeScript sources, which may open in a browser or a script runner.
 */
const OPENABLE = new Set([
  ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv",
  ".css",
  ".png", ".jpg", ".jpeg", ".gif", ".pdf",
]);

/**
 * The real path of `rel` inside one of `roots` (tried in order): a regular file with an openable
 * extension, symlinks resolved. Null when it is missing, escapes every root, or isn't openable.
 */
export async function openableFile(rel: unknown, roots: string[]): Promise<string | null> {
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
    if (!OPENABLE.has(path.extname(real).toLowerCase())) continue;
    const stat = await fs.stat(real).catch(() => null);
    if (stat?.isFile()) return real;
  }
  return null;
}

/**
 * Hands `target` (from openableFile) to `open` (shell.openPath) only if it is still a regular file, not
 * a link, with no link on its way (its real path is itself), inside one of `roots`: it or a folder above
 * it may have been swapped since it was checked. `open` answers "" on success.
 */
export async function openIfStillSafe(target: string, roots: string[], open: (p: string) => Promise<string>): Promise<boolean> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  const real = await fs.realpath(target).catch(() => null);
  if (real !== target) return false;
  const realRoots = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => null)));
  if (!realRoots.some((r) => r !== null && real.startsWith(r + path.sep))) return false;
  return (await open(target)) === "";
}
