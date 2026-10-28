import { constants as C, promises as fs } from "node:fs";
import path from "node:path";
import { ruleUnsafePath } from "@humanharness/runtime";
import { homeOrDotFolder } from "./references";
import { folderProblem, realFolder } from "./validate";

/** Why a folder can't be linked (hatches spec §3.2). Each has a sentence in en.json `hatches.refused.<reason>`. */
export type LinkRefusal =
  | "engine-home" | "home" | "system" | "too-broad" | "protected" | "main-folder" | "other-scope-write"
  | "nested" | "already-linked" | "not-git" | "not-folder" | "unsafe-name";

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
  // A comma, glob or rule character, or a control character: Claude's permission rules couldn't spell the folder
  // (claudeArgs throws on one), so it is refused here rather than failing every turn. Relative paths: below.
  if (path.isAbsolute(dir) && ruleUnsafePath(dir)) return "unsafe-name";
  if (norm(dir) === norm(ctx.home)) return "home";
  // ~/.claude, ~/.codex, every other dot folder in home (credentials, engine config) and what's inside them.
  if (homeOrDotFolder(dir, ctx.home)) return "engine-home";
  // Before the main-folder rule, so ~/Documents reads as too broad rather than as "contains the main folder".
  const problem = folderProblem(dir, ctx.home);
  if (problem === "root") return "system";
  // ~/.claude and the other engine homes were caught above: what's left is a system folder or ~/Library.
  if (problem === "protected") return isSystemPath(dir) ? "system" : "protected";
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
  if (!st.isFile()) return false;
  // Opened without following a link swapped in since the lstat, nor blocking on a FIFO; at most 4 KB read.
  const fh = await fs.open(dot, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK).catch(() => null);
  if (!fh) return false;
  try {
    const fst = await fh.stat();
    if (!fst.isFile() || fst.size > GITDIR_FILE_MAX) return false;
    const buf = Buffer.alloc(GITDIR_FILE_MAX);
    const { bytesRead } = await fh.read(buf, 0, GITDIR_FILE_MAX, 0);
    return buf.subarray(0, bytesRead).toString("utf8").split("\n")[0].startsWith("gitdir:");
  } catch {
    return false;
  } finally {
    await fh.close().catch(() => {});
  }
}

const GITDIR_FILE_MAX = 4096;

/** `p` with links resolved; as written (resolved) when it can't be, so a comparison never gets looser. */
const realOr = (p: string) => realFolder(p).catch(() => path.resolve(p));

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
  // The context may hold paths as written (the configured folder, a home reached through a link): compare the real
  // path against those and against where they really are.
  const realCtx: Omit<LinkContext, "isGit"> = {
    ...ctx,
    home: await realOr(ctx.home),
    folder: await realOr(ctx.folder),
    root: ctx.root === undefined ? undefined : await realOr(ctx.root),
    sameScope: await Promise.all(ctx.sameScope.map(realOr)),
    otherScopesWrite: await Promise.all(ctx.otherScopesWrite.map(realOr)),
  };
  const refused = linkRefusal(real, { ...realCtx, isGit }) ?? linkRefusal(real, { ...ctx, isGit });
  if (refused) return { refused };
  return { path: real, tracked: ctx.mode === "write" && !isGit };
}
