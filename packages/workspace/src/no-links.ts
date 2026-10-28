import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

// File access under a base the agent can write to (plugins spec §3.3: plugin data, the Attention inbox). The agent
// can put a symlink anywhere in the base, so every path below `root` is walked with lstat and refused when any part
// of it is a link or not a folder; the file itself is opened with O_NOFOLLOW (where the OS has it) and must be a
// regular file. `root` itself (the base) is trusted: it may be a link the person chose (macOS's /tmp is one).
// A link swapped in between the walk and the open of a parent folder is not caught (no openat in Node); the walk
// runs again right before every rename.

/** A path under the base that is (or passes through) a link, or isn't a folder/regular file where one is needed. */
export class LinkRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkRefused";
  }
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

function below(root: string, target: string): string[] {
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new LinkRefused(`${target} is not inside ${root}`);
  return rel.split(path.sep);
}

/**
 * Checks every folder between `root` and `file` (not the file): each must be a real folder. A missing one ends the
 * walk (false), or is created when `create` is set. True when every folder exists.
 */
export async function checkFolders(root: string, file: string, create = false): Promise<boolean> {
  const parts = below(root, file).slice(0, -1);
  let at = root;
  for (const part of parts) {
    at = path.join(at, part);
    let st = await fs.lstat(at).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (!st) {
      if (!create) return false;
      await fs.mkdir(at).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
      st = await fs.lstat(at);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new LinkRefused(`${path.relative(root, at)} is not a plain folder`);
  }
  return true;
}

/** The text of `file`, or null when it (or a folder above it) doesn't exist. Refuses links, non-files and files over `maxBytes`. */
export async function readNoLinks(root: string, file: string, maxBytes: number): Promise<string | null> {
  if (!(await checkFolders(root, file))) return null;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code === "ELOOP" || code === "EMLINK") throw new LinkRefused(`${path.relative(root, file)} is a link`);
    throw err;
  }
  try {
    const st = await handle.stat();
    // A hard link (nlink > 1) could be another file anywhere on the disk.
    if (!st.isFile() || st.nlink > 1) throw new LinkRefused(`${path.relative(root, file)} is not a plain file`);
    if (st.size > maxBytes) throw new LinkRefused(`${path.relative(root, file)} is too large`);
    const buf = Buffer.alloc(maxBytes + 1);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buf, size, buf.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maxBytes) throw new LinkRefused(`${path.relative(root, file)} is too large`);
    }
    return buf.subarray(0, size).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Refuses when `file` exists and isn't a regular file (a link, a folder, a pipe). */
async function plainOrMissing(root: string, file: string): Promise<boolean> {
  const st = await fs.lstat(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (st && (!st.isFile() || st.nlink > 1)) throw new LinkRefused(`${path.relative(root, file)} is not a plain file`);
  return st !== null;
}

/** Writes `text` to `file` atomically (a new temp file, then a rename), creating real folders, never through a link. */
export async function writeNoLinks(root: string, file: string, text: string): Promise<void> {
  await checkFolders(root, file, true);
  await plainOrMissing(root, file);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    try {
      await handle.writeFile(text);
    } finally {
      await handle.close();
    }
    await checkFolders(root, file);
    await plainOrMissing(root, file);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Removes the one file `file` (never a folder, never recursively); a link there is refused, not followed. */
export async function removeNoLinks(root: string, file: string): Promise<void> {
  if (!(await checkFolders(root, file))) return;
  if (await plainOrMissing(root, file)) await fs.rm(file, { force: true });
}
