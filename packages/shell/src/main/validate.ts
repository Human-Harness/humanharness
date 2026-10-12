import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig, FolderProblem } from "@humanharness/ui/client";

/** Home folders the user keeps other things in: too broad to hand to an agent as a whole (~/Library is PROTECTED). */
const STANDARD_HOME_FOLDERS = ["Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music", "Public", "Applications"];
/** Folders holding CLI credentials and app data: never inside or above them. Path checks only, never read. */
const PROTECTED = [".claude", ".codex", ".gemini", "Library"];
/** Top-level system folders: never inside or above them. */
const SYSTEM = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/Applications", "/Library", "/opt"];
/** Folders that are fine to use inside, but not as themselves or above. */
const ONLY_INSIDE = ["/Volumes"];
/** Cloud drives under ~/Library: a folder `depth` levels inside is fine, the drive itself and above are not. */
const CLOUD_DRIVES = [
  { dir: "Library/Mobile Documents/com~apple~CloudDocs", depth: 1 },
  // ~/Library/CloudStorage/<provider>/<folder>: the provider folder itself is the whole drive.
  { dir: "Library/CloudStorage", depth: 2 },
];

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side.
const norm = (p: string) => path.resolve(p).toLowerCase();
const isInside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
/** How many levels `child` is below `parent`, or -1 when it isn't inside it. */
const depthBelow = (child: string, parent: string) =>
  isInside(child, parent) ? path.relative(parent, child).split(path.sep).filter(Boolean).length : -1;

/** Why `folder` can't be the harness folder, judging the path as written. Null when it can. */
export function folderProblem(folder: string, home: string): FolderProblem | null {
  if (typeof folder !== "string" || !path.isAbsolute(folder)) return "not-absolute";
  const f = norm(folder);
  const h = norm(home);
  if (f === norm("/")) return "root";
  if (f === h) return "home";
  if (path.dirname(f) === h && STANDARD_HOME_FOLDERS.some((n) => n.toLowerCase() === path.basename(f))) return "too-broad";
  for (const s of SYSTEM.map(norm)) {
    if (isInside(f, s) || isInside(s, f)) return "protected";
  }
  for (const s of ONLY_INSIDE.map(norm)) {
    if (isInside(s, f)) return "protected";
  }
  const inCloudDrive = CLOUD_DRIVES.some(({ dir, depth }) => depthBelow(f, norm(path.join(home, dir))) >= depth);
  for (const p of PROTECTED.map((n) => norm(path.join(home, n)))) {
    if (isInside(p, f)) return "protected";
    if (isInside(f, p) && !inCloudDrive) return "protected";
  }
  return null;
}

export type Realpath = (p: string) => Promise<string>;

/** fs.realpath, except that a dangling symlink is an error rather than a missing path. */
const realpathOnDisk: Realpath = async (p) => {
  try {
    return await fs.realpath(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" && (await fs.lstat(p).then(() => true, () => false))) {
      throw Object.assign(new Error(`Broken link: ${p}`), { code: "EBROKENLINK" });
    }
    throw err;
  }
};

/**
 * Where `folder` really is, with symlinks resolved. A folder that doesn't exist yet resolves
 * through its nearest existing parent, with the missing part joined back on.
 */
export async function realFolder(folder: string, realpath: Realpath = realpathOnDisk): Promise<string> {
  let existing = path.resolve(folder);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(existing), ...missing);
    } catch (err) {
      const parent = path.dirname(existing);
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || parent === existing) throw err;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/** Why `folder` can't be the harness folder, judged as written and where it really is. Null when it can. */
export async function checkFolder(folder: string, home: string, realpath: Realpath = realpathOnDisk): Promise<FolderProblem | null> {
  const asWritten = folderProblem(folder, home);
  if (asWritten) return asWritten;
  try {
    return folderProblem(await realFolder(folder, realpath), await realFolder(home, realpath));
  } catch {
    return "not-absolute";
  }
}

export interface ValidationContext {
  engineIds: string[];
  languages: string[];
  home: string;
  /** Defaults to the real file system. */
  realpath?: Realpath;
}

export type ConfigProblem = FolderProblem | "invalid" | "engine-unavailable" | "language-unavailable";

/** Checks the fields present in `c`. Returns why it's invalid, or null. */
export async function configProblem(c: AppConfig, ctx: ValidationContext): Promise<ConfigProblem | null> {
  if (typeof c !== "object" || c === null) return "invalid";
  if (c.engineId !== undefined && (typeof c.engineId !== "string" || !ctx.engineIds.includes(c.engineId))) {
    return "engine-unavailable";
  }
  if (c.language !== undefined && (typeof c.language !== "string" || !ctx.languages.includes(c.language))) {
    return "language-unavailable";
  }
  if (c.appearance !== undefined && !["system", "light", "dark"].includes(c.appearance as string)) return "invalid";
  if (c.models !== undefined && (typeof c.models !== "object" || c.models === null || Array.isArray(c.models))) return "invalid";
  if (c.folder !== undefined) return checkFolder(c.folder, ctx.home, ctx.realpath);
  return null;
}

/** Whether `url` is the app's own page: the dev server, or the bundled renderer file. */
export function isAppUrl(url: string, where: { devUrl?: string; rendererFile: string }): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (where.devUrl) return u.origin === new URL(where.devUrl).origin;
  return u.protocol === "file:" && u.pathname === pathToFileURL(where.rendererFile).pathname;
}
