import { promises as fs } from "node:fs";
import path from "node:path";
import { refusedShape } from "@humanharness/harness-sdk/documents";

// Folder-file helpers the core and the context-panel mod share (they sat in the shell's main until the mod took the
// context service): the panel's token estimate, folder paths, which paths a prompt may name, and where a file is.

/** The panel's estimate (§3.1, "aprox."): characters / 4, rounded to 100; at least 100 for any text, 0 for none. */
export function approxTokens(chars: number): number {
  if (!(chars > 0)) return 0;
  return Math.max(100, Math.round(chars / 4 / 100) * 100);
}

/** `p` relative to `base`, forward slashes; a relative `p` is taken from `base`. Null for `base` itself and anything outside. */
export function folderPath(base: string, p: string): string | null {
  const rel = path.relative(base, path.resolve(base, p));
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** Characters that are not seen but change how a line reads: bidi embeddings, overrides and isolates, zero widths. */
const hiddenChar = (code: number): boolean =>
  (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || (code >= 0x200b && code <= 0x200d) || code === 0xfeff;

/** A character `addablePath` refuses: a backtick, a control character (C0, DEL, C1), a line or paragraph separator, a hidden one. */
export const refusedChar = (code: number): boolean =>
  code === 96 || code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || hiddenChar(code);

/**
 * A path that can sit inside the prompt's backticks: no backtick, no control character (C0, DEL, C1), no line or
 * paragraph separator, no bidi control or zero-width character (the person would not see what the agent reads), at
 * most 1,000 characters.
 */
export function addablePath(file: string): boolean {
  if (file.length === 0 || file.length > 1000) return false;
  for (let i = 0; i < file.length; i++) if (refusedChar(file.charCodeAt(i))) return false;
  return true;
}

/**
 * Whether `target` (a real path) is still a regular file, not a link, with no link on its way (its real path is
 * itself), inside one of `roots`: it or a folder above it may have been swapped since it was checked.
 */
export async function stillSafe(target: string, roots: string[]): Promise<boolean> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  const real = await fs.realpath(target).catch(() => null);
  if (real !== target) return false;
  const realRoots = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => null)));
  return realRoots.some((r) => r !== null && real.startsWith(r + path.sep));
}

export type Located = { ok: true; file: string; root: string } | { ok: false; reason: "outside" | "missing" };

/**
 * Where `rel` is, tried in each root in order (the person's folder first, then the reference folders): a regular file
 * whose real path is inside the same root. A path that is inside a root but not there is "missing"; a path that leaves
 * every root, or a link that points out, is "outside".
 */
export async function locate(rel: unknown, roots: string[]): Promise<Located> {
  if (refusedShape(rel)) return { ok: false, reason: "outside" };
  const relPath = rel as string;
  let inside = false;
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;
    const candidate = path.resolve(realRoot, relPath);
    if (!candidate.startsWith(realRoot + path.sep)) continue;
    inside = true;
    const real = await fs.realpath(candidate).catch(() => null);
    if (!real) continue;
    if (!real.startsWith(realRoot + path.sep)) return { ok: false, reason: "outside" };
    const stat = await fs.stat(real).catch(() => null);
    if (stat?.isFile()) return { ok: true, file: real, root: realRoot };
  }
  return { ok: false, reason: inside ? "missing" : "outside" };
}

/** The budget of pinned text when neither the person nor the manifest set one (context-panel spec §4.2). */
export const DEFAULT_PINNED_TOKENS = 3000;

/** A fence one backtick longer than the longest backtick run in `text` (at least three). A loop, never a regex. */
export function fenceFor(text: string): string {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 96) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** Whether `dir` is the home folder, a dot-folder directly in it, or inside one. Without case (macOS is usually case-insensitive). */
export function homeOrDotFolder(dir: string, home: string): boolean {
  const norm = (p: string) => path.resolve(p).toLowerCase();
  const rel = path.relative(norm(home), norm(dir));
  if (rel === "") return true;
  const first = rel.split(path.sep)[0];
  // Outside the home folder: not this rule's concern.
  if (first === ".." || path.isAbsolute(rel)) return false;
  return first.startsWith(".");
}
