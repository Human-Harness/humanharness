import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "@humanharness/ui";

/** Home folders the user keeps other things in: too broad to hand to an agent as a whole. */
const STANDARD_HOME_FOLDERS = ["Desktop", "Documents", "Downloads", "Library", "Pictures", "Movies", "Music", "Public", "Applications"];
/** Folders holding CLI credentials and app data: never inside or above them. Path checks only, never read. */
const PROTECTED = [".claude", ".codex", "Library"];

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side.
const norm = (p: string) => path.resolve(p).toLowerCase();
const isInside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);

/** Why `folder` can't be the harness folder, or null when it can. */
export function folderProblem(folder: string, home: string): string | null {
  if (typeof folder !== "string" || !path.isAbsolute(folder)) return "The folder must be an absolute path";
  const f = norm(folder);
  const h = norm(home);
  if (f === norm("/")) return "The folder can't be the root of the disk";
  if (f === h) return "The folder can't be your home folder";
  if (path.dirname(f) === h && STANDARD_HOME_FOLDERS.some((n) => n.toLowerCase() === path.basename(f))) {
    return "Pick a folder inside it, not the whole folder";
  }
  for (const p of PROTECTED.map((n) => norm(path.join(home, n)))) {
    if (isInside(f, p) || isInside(p, f)) return "The folder can't contain or be inside a system or agent folder";
  }
  return null;
}

export interface ValidationContext {
  engineIds: string[];
  languages: string[];
  home: string;
}

/** Checks the fields present in `c`. Returns why it's invalid, or null. */
export function configProblem(c: AppConfig, ctx: ValidationContext): string | null {
  if (typeof c !== "object" || c === null) return "Invalid settings";
  if (c.engineId !== undefined && (typeof c.engineId !== "string" || !ctx.engineIds.includes(c.engineId))) {
    return "This engine isn't available";
  }
  if (c.language !== undefined && (typeof c.language !== "string" || !ctx.languages.includes(c.language))) {
    return "This language isn't available";
  }
  if (c.folder !== undefined) return folderProblem(c.folder, ctx.home);
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
