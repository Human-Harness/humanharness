import { type Dirent, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHATS_DIR, DEFAULT_IGNORED_DIRS, GitIgnore, deniedPath } from "@humanharness/search";
import { homeOrDotFolder } from "../references";

/** A file found by the walk. `link`: a symbolic link, indexed by its own name only and never followed (§8.1). */
export interface WalkEntry {
  rel: string;
  size: number;
  mtimeMs: number;
  link: boolean;
}

export interface WalkOptions {
  /** At most this many entries; past it, `truncated`. */
  max: number;
  /** More exact paths to leave out (the engine's instructions file). */
  extraDenied?: readonly string[];
  /** Folders not walked (relative): the chats, which the build indexes by entry. */
  skipDirs?: readonly string[];
  /** The home folder whose dot-folders are never walked (tests pass a fake one). Default: the real one. */
  home?: string;
}

const MAX_GITIGNORE_BYTES = 1024 * 1024;

/** A folder's `.gitignore` when it is a plain file of reasonable size; null otherwise. */
async function readIgnore(dir: string): Promise<string | null> {
  const file = path.join(dir, ".gitignore");
  const st = await fs.lstat(file).catch(() => null);
  if (!st?.isFile() || st.size > MAX_GITIGNORE_BYTES) return null;
  return fs.readFile(file, "utf8").catch(() => null);
}

/**
 * Whether `root` may be walked at all: never the home folder, nor a dot-folder in it or inside one (~/.claude,
 * ~/.codex, ~/.ssh, ~/.config/opencode, ~/.local/share/opencode...), also when `root` is a link to one (§8.1).
 * The folder and the references are checked before they get here; this is the walk's own fail-closed check.
 */
async function rootAllowed(root: string, home: string = os.homedir()): Promise<boolean> {
  const real = await fs.realpath(root).catch(() => null);
  if (!real) return false;
  const realHome = await fs.realpath(home).catch(() => home);
  return !homeOrDotFolder(real, realHome);
}

/** `ignore` throws on a path it doesn't take (`./x`, `/x`); such a path counts as ignored (fail closed). */
function isIgnored(ig: GitIgnore, rel: string, isDir: boolean): boolean {
  try {
    return ig.ignored(rel, isDir);
  } catch {
    return true;
  }
}

/** Every file under `root` that may be indexed, in name order, without following any link. */
export async function walkRoot(root: string, o: WalkOptions): Promise<{ entries: WalkEntry[]; truncated: boolean }> {
  const entries: WalkEntry[] = [];
  if (!(await rootAllowed(root, o.home))) return { entries, truncated: false };
  const ig = new GitIgnore();
  const rootIgnore = await readIgnore(root);
  if (rootIgnore !== null) ig.add("", rootIgnore);
  // The root's own .gitignore decides, not whether any was loaded: a nested one alone keeps the defaults (§8.1).
  const defaults = rootIgnore === null;
  let truncated = false;
  const walk = async (dirRel: string): Promise<void> => {
    const abs = dirRel ? path.join(root, dirRel) : root;
    if (dirRel) {
      const nested = await readIgnore(abs);
      if (nested !== null) ig.add(dirRel, nested);
    }
    let names: Dirent[];
    try {
      names = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of names) {
      if (truncated) return;
      const rel = dirRel ? `${dirRel}/${d.name}` : d.name;
      if (deniedPath(rel, o.extraDenied) || o.skipDirs?.includes(rel)) continue;
      if (defaults && DEFAULT_IGNORED_DIRS.includes(d.name)) continue;
      const isDir = d.isDirectory();
      if (isIgnored(ig, rel, isDir)) continue;
      if (isDir) {
        await walk(rel);
        continue;
      }
      if (!d.isFile() && !d.isSymbolicLink()) continue;
      const st = await fs.lstat(path.join(abs, d.name)).catch(() => null);
      if (!st) continue;
      if (entries.length >= o.max) {
        truncated = true;
        return;
      }
      entries.push({ rel, size: st.isFile() ? st.size : 0, mtimeMs: st.mtimeMs, link: st.isSymbolicLink() });
    }
  };
  await walk("");
  return { entries, truncated };
}

/**
 * A commit's paths (relative to `root`): those still there and allowed come back as entries, the rest as `missing`
 * (their documents leave the index). Each folder's `.gitignore` above a path is read once.
 */
export async function statPaths(root: string, rels: readonly string[], o: { extraDenied?: readonly string[]; home?: string }): Promise<{ entries: WalkEntry[]; missing: string[] }> {
  if (!(await rootAllowed(root, o.home))) return { entries: [], missing: [...rels] };
  const ig = new GitIgnore();
  const rootIgnore = await readIgnore(root);
  if (rootIgnore !== null) ig.add("", rootIgnore);
  const defaults = rootIgnore === null;
  const loaded = new Set<string>([""]);
  const entries: WalkEntry[] = [];
  const missing: string[] = [];
  for (const rel of rels) {
    if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) continue;
    const parts = rel.split("/");
    let skip = deniedPath(rel, o.extraDenied) || rel.startsWith(CHATS_DIR);
    for (let i = 1; i < parts.length && !skip; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!loaded.has(dir)) {
        loaded.add(dir);
        const text = await readIgnore(path.join(root, dir));
        if (text !== null) ig.add(dir, text);
      }
      skip = (defaults && DEFAULT_IGNORED_DIRS.includes(parts[i - 1])) || isIgnored(ig, dir, true);
    }
    if (!skip) skip = (defaults && DEFAULT_IGNORED_DIRS.includes(parts[parts.length - 1])) || isIgnored(ig, rel, false);
    const st = skip ? null : await fs.lstat(path.join(root, rel)).catch(() => null);
    if (!st || !(st.isFile() || st.isSymbolicLink())) {
      missing.push(rel);
      continue;
    }
    entries.push({ rel, size: st.isFile() ? st.size : 0, mtimeMs: st.mtimeMs, link: st.isSymbolicLink() });
  }
  return { entries, missing };
}
