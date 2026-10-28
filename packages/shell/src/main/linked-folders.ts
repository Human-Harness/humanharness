import { promises as fs } from "node:fs";
import path from "node:path";
import { homeOrDotFolder } from "./references";
import { folderProblem, realFolder } from "./validate";

/** Why a folder can't be linked (hatches spec §3.2). Each has a sentence in en.json `hatches.refused.<reason>`. */
export type LinkRefusal =
  | "engine-home" | "home" | "system" | "too-broad" | "protected" | "main-folder" | "other-scope-write"
  | "nested" | "already-linked" | "not-git" | "not-folder" | "comma";

export interface LinkContext {
  /** The home folder, real. */
  home: string;
  /** The main (work) folder, real: the base. */
  folder: string;
  /** With profiles: the app's folder (every profile's folder is inside it). */
  root?: string;
  /** The real paths this scope already links (any key). */
  sameScope: string[];
  /** The real paths other scopes link in `write` mode. */
  otherScopesWrite: string[];
  mode: "read" | "write";
  history: "auto" | "own";
  isGit: boolean;
}

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side (as validate.ts).
const norm = (p: string) => path.resolve(p).toLowerCase();
const inside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

const SYSTEM_ROOTS = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/Applications", "/Library", "/opt", "/Volumes"];
const isSystemPath = (dir: string) => SYSTEM_ROOTS.some((s) => inside(dir, s) || inside(s, dir)) || /^[a-z]:\\windows/i.test(dir);

/** The first refusal for the real path `dir`, or null. Pure: path comparisons only, never a read (L8). */
export function linkRefusal(dir: string, ctx: LinkContext): LinkRefusal | null {
  if (dir.includes(",")) return "comma";
  if (norm(dir) === norm(ctx.home)) return "home";
  // ~/.claude, ~/.codex, every other dot folder in home (credentials, engine config) and what's inside them.
  if (homeOrDotFolder(dir, ctx.home)) return "engine-home";
  // Before the main-folder rule, so ~/Documents reads as too broad rather than as "contains the main folder".
  const problem = folderProblem(dir, ctx.home);
  if (problem === "root") return "system";
  if (problem === "protected") return isSystemPath(dir) ? "system" : "engine-home";
  if (problem === "too-broad") return "too-broad";
  if (problem === "not-absolute") return "not-folder";
  if (problem) return "protected";
  if (inside(dir, ctx.folder) || inside(ctx.folder, dir)) return "main-folder";
  if (ctx.root && (inside(dir, ctx.root) || inside(ctx.root, dir))) return "main-folder";
  if (ctx.sameScope.some((p) => norm(p) === norm(dir))) return "already-linked";
  if (ctx.sameScope.some((p) => inside(dir, p) || inside(p, dir))) return "nested";
  if (ctx.otherScopesWrite.some((p) => norm(p) === norm(dir))) return "other-scope-write";
  if (ctx.history === "own" && !ctx.isGit) return "not-git";
  return null;
}

/**
 * Whether `dir` is a git repository (Decision 3): `<dir>/.git` is a folder holding `HEAD`, or a file whose first line
 * starts with `gitdir:`. A link at `.git` is never followed. Reads nothing else.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  const dot = path.join(dir, ".git");
  const st = await fs.lstat(dot).catch(() => null);
  if (!st || st.isSymbolicLink()) return false;
  if (st.isDirectory()) return (await fs.lstat(path.join(dot, "HEAD")).catch(() => null))?.isFile() === true;
  if (!st.isFile() || st.size > 4096) return false;
  const first = (await fs.readFile(dot, "utf8").catch(() => "")).split("\n")[0];
  return first.startsWith("gitdir:");
}

/**
 * Checks a picked folder: as written and where it really is (links resolved), then git. Answers the real path and
 * whether the core history tracks it (Decision 2), or why it is refused.
 */
export async function checkLink(
  picked: string,
  ctx: Omit<LinkContext, "isGit">,
): Promise<{ path: string; tracked: boolean } | { refused: LinkRefusal }> {
  if (typeof picked !== "string" || !path.isAbsolute(picked)) return { refused: "not-folder" };
  // As written, git is not known yet: "not-git" is decided on the real folder below.
  const asWritten = linkRefusal(path.resolve(picked), { ...ctx, isGit: true });
  if (asWritten) return { refused: asWritten };
  let real: string;
  try {
    real = await realFolder(picked);
    if (!(await fs.stat(real)).isDirectory()) return { refused: "not-folder" };
  } catch {
    return { refused: "not-folder" };
  }
  const isGit = await isGitRepo(real);
  const refused = linkRefusal(real, { ...ctx, isGit });
  if (refused) return { refused };
  return { path: real, tracked: ctx.mode === "write" && !isGit };
}
