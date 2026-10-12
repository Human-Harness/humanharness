import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Files "Open" may hand to the system: text, data and images. Never apps, scripts or installers
 * (`.app`, `.command`, `.sh`, `.pkg`…), which the system would run instead of showing.
 */
const OPENABLE = new Set([
  ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".pdf",
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
