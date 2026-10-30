import { type Stats, promises as fs } from "node:fs";
import path from "node:path";
import { LinkRefused, TooLarge, readNoLinks } from "@humanharness/workspace";

/**
 * A tool's `ctx.files` (tools spec §4.2; threat row T8): read and list inside the person's folder and its reference
 * folders, nothing else. A path is relative and in `/` form: `refs/<id>/…` reaches the reference `<id>`, anything else
 * the folder. No `..`, no absolute path, no `.harness` or `.git` at any depth; every level is `lstat`ed and a link is
 * refused (a read) or skipped (a list), never followed; a hard link (nlink > 1) is refused too. The roots themselves
 * are the app's and trusted. A message names the path as the tool wrote it, never where the folder is on disk.
 */

export const FILES_LIMITS = {
  readBytes: 1024 * 1024,
  listEntries: 1000,
  /** Entries a list looks at before it stops, whatever matched. */
  listVisits: 20_000,
  pathChars: 4096,
  segments: 64,
  globChars: 256,
} as const;

/** A path the tool may not reach: what the trace shows as "access denied". */
export class ToolFileRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolFileRefused";
  }
}

/** A file that isn't there, isn't one or is too large: a message of ours, naming only the path the tool wrote. */
class ToolFileError extends Error {}
const fileError: (message: string) => never = (message) => {
  throw new ToolFileError(message);
};

/** Any other failure (EACCES, ELOOP…) is one fixed line: the system's message would tell where the folder is on disk. */
async function shielded<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ToolFileRefused || err instanceof ToolFileError) throw err;
    throw new ToolFileError(`${name} can't be read`);
  }
}

export interface ToolFiles {
  read(rel: string): Promise<string>;
  /**
   * The files under `dir` (all depths), as paths `read` takes (`notes/a.md`, `refs/<id>/…`), sorted, at most
   * FILES_LIMITS.listEntries. `glob` is matched against the path below `dir`.
   */
  list(dir: string, glob?: string): Promise<string[]>;
}

/** Compared lower-cased: on a disk that ignores case (macOS), `.GIT` is `.git`. */
const HIDDEN = new Set([".harness", ".git"]);
const hiddenName = (name: string) => HIDDEN.has(name.toLowerCase());
const refuse = (message: string): never => {
  throw new ToolFileRefused(message);
};

interface Resolved {
  /** The folder or reference root. */
  root: string;
  /** The path's parts below the root. */
  parts: string[];
  /** What `read` takes for the root: "" or "refs/<id>". */
  prefix: string;
}

function resolve(rel: unknown, references: readonly { id: string; path: string }[]): Resolved {
  if (typeof rel !== "string" || rel.length > FILES_LIMITS.pathChars || rel.includes("\0")) return refuse("A path is text of at most 4096 characters");
  const text = rel as string;
  if (text.startsWith("/") || text.includes("\\") || /^[A-Za-z]:/.test(text)) refuse(`${text}: a path is relative to the folder`);
  const parts = text.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length > FILES_LIMITS.segments) refuse(`${text}: too many folders`);
  if (parts.includes("..")) refuse(`${text}: a path stays inside the folder`);
  const hidden = parts.find(hiddenName);
  if (hidden !== undefined) refuse(`${text}: ${hidden} is not for tools`);
  if (parts[0] !== "refs") return { root: "", parts, prefix: "" };
  const id = parts[1];
  const ref = id === undefined ? undefined : references.find((r) => r.id === id);
  if (!ref) return refuse(`No reference "${String(id ?? "").slice(0, 64)}"`);
  return { root: ref.path, parts: parts.slice(2), prefix: `refs/${id}` };
}

const shown = (r: Resolved, upTo: number) => [r.prefix, ...r.parts.slice(0, upTo)].filter((p) => p !== "").join("/");

async function lstatOrNull(p: string): Promise<Stats | null> {
  return fs.lstat(p).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  });
}

/** Walks `r` level by level: each folder a real one, no link anywhere. The last part's stats (null: missing). */
async function walk(r: Resolved): Promise<Stats | null> {
  let at = r.root;
  let st: Stats | null = null;
  for (let i = 0; i < r.parts.length; i++) {
    at = path.join(at, r.parts[i]!);
    st = await lstatOrNull(at);
    if (st === null) return null;
    if (st.isSymbolicLink()) refuse(`${shown(r, i + 1)} is a link`);
    if (i < r.parts.length - 1 && !st.isDirectory()) return null;
  }
  // The root itself is the app's (it may be a link the person chose, as macOS's /tmp is): followed.
  return st ?? (await fs.stat(r.root).catch(() => null));
}

export function toolFiles({ base, references }: { base: string; references: { id: string; path: string }[] }): ToolFiles {
  const rooted = (r: Resolved): Resolved => (r.root === "" ? { ...r, root: base } : r);

  return {
    async read(rel) {
      const r = rooted(resolve(rel, references));
      const name = shown(r, r.parts.length);
      if (r.parts.length === 0) refuse("A path names a file, not the folder");
      return shielded(name, async () => {
        const st = await walk(r);
        if (st === null) fileError(`${name} is not there`);
        if (!st.isFile()) fileError(`${name} is not a file`);
        if (st.nlink > 1) refuse(`${name} is not a plain file`);
        if (st.size > FILES_LIMITS.readBytes) fileError(`${name} is larger than 1 MB`);
        try {
          // The same rules again at the open: O_NOFOLLOW, a regular file, one link, the size cap.
          const text = await readNoLinks(r.root, path.join(r.root, ...r.parts), FILES_LIMITS.readBytes);
          if (text === null) fileError(`${name} is not there`);
          return text;
        } catch (err) {
          if (err instanceof TooLarge) fileError(`${name} is larger than 1 MB`);
          if (err instanceof LinkRefused) refuse(`${name} is not a plain file`);
          throw err;
        }
      });
    },

    async list(dir, glob) {
      if (glob !== undefined && (typeof glob !== "string" || glob.length > FILES_LIMITS.globChars)) refuse("A glob is text of at most 256 characters");
      const r = rooted(resolve(dir, references));
      const name = shown(r, r.parts.length) || ".";
      return shielded(name, async () => {
        const st = await walk(r);
        if (st === null) fileError(`${name} is not there`);
        if (!st.isDirectory()) fileError(`${name} is not a folder`);
        const start = path.join(r.root, ...r.parts);
        const lead = shown(r, r.parts.length);
        const found: string[] = [];
        let visits = 0;
        // Depth-first, without following anything: links and hard links are skipped, .harness and .git never entered.
        const stack: { abs: string; below: string[] }[] = [{ abs: start, below: [] }];
        while (stack.length > 0 && visits < FILES_LIMITS.listVisits) {
          const { abs, below } = stack.pop()!;
          // The asked folder unreadable is an error; one below it is skipped.
          const entries = below.length === 0 ? await fs.readdir(abs, { withFileTypes: true }) : await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
          for (const e of entries) {
            if (++visits > FILES_LIMITS.listVisits) break;
            if (hiddenName(e.name) || e.isSymbolicLink()) continue;
            // The base's own top-level refs folder: `read` takes refs/<id>/ as a reference, so it is never listed.
            if (r.prefix === "" && r.parts.length === 0 && below.length === 0 && e.name === "refs") continue;
            const next = [...below, e.name];
            if (e.isDirectory()) {
              if (next.length < FILES_LIMITS.segments) stack.push({ abs: path.join(abs, e.name), below: next });
              continue;
            }
            if (!e.isFile()) continue;
            const est = await lstatOrNull(path.join(abs, e.name)).catch(() => null);
            if (!est || !est.isFile() || est.nlink > 1) continue;
            const sub = next.join("/");
            if (glob === undefined || globMatch(glob, sub)) found.push(lead === "" ? sub : `${lead}/${sub}`);
          }
        }
        return found.sort().slice(0, FILES_LIMITS.listEntries);
      });
    },
  };
}

/** One segment against a pattern segment where `*` is any run of characters (greedy with backtracking, linear-ish). */
function segmentMatch(p: string, s: string): boolean {
  let pi = 0;
  let si = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (pi < p.length && p[pi] !== "*" && p[pi] === s[si]) {
      pi++;
      si++;
    } else if (pi < p.length && p[pi] === "*") {
      star = pi++;
      mark = si;
    } else if (star !== -1) {
      pi = star + 1;
      si = ++mark;
    } else return false;
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

/**
 * A glob against a `/` path: `*` within a segment, `**` (a whole segment) across zero or more. Built from the pattern
 * text without RegExp; a table over (pattern segment, path segment), so no pattern blows up.
 */
export function globMatch(glob: string, rel: string): boolean {
  const ps = glob.split("/").filter((p) => p !== "");
  const ss = rel.split("/");
  // can[i][j]: pattern segments from i match path segments from j.
  const can: boolean[][] = Array.from({ length: ps.length + 1 }, () => new Array<boolean>(ss.length + 1).fill(false));
  can[ps.length]![ss.length] = true;
  for (let i = ps.length - 1; i >= 0; i--) {
    for (let j = ss.length; j >= 0; j--) {
      if (ps[i] === "**") can[i]![j] = can[i + 1]![j]! || (j < ss.length && can[i]![j + 1]!);
      else can[i]![j] = j < ss.length && segmentMatch(ps[i]!, ss[j]!) && can[i + 1]![j + 1]!;
    }
  }
  return can[0]![0]!;
}
