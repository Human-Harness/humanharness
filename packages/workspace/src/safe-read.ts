import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

/** What `readCapped` found: the bytes, the size when it is over the cap, or null when the file is not safe to read. */
export type CappedRead = { bytes: Buffer; mtime: Date } | { size: number } | null;

/** What `readPrefix` found: the first bytes, the whole size and, when asked, git's blob id of the whole file. */
export type PrefixRead = { bytes: Buffer; size: number; oid?: string } | null;

/**
 * Opens `file`, checked with `stillSafe` right before it is opened, without following a link and without blocking (a
 * FIFO swapped in can't hang the process), checked again once open (the handle is still the file at that path, and
 * `stillSafe` still holds). Null when it is no longer safe, not a regular file, or a hard link (`nlink > 1`: its other
 * names may be anywhere). The size is the one it had when opened: reads never go past it.
 */
async function openSafe(file: string, stillSafe: () => Promise<boolean>): Promise<{ handle: FileHandle; size: number; mtime: Date } | null> {
  if (!(await stillSafe())) return null;
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    const there = await fs.stat(file).catch(() => null);
    if (!stat.isFile() || stat.nlink > 1 || !there || there.dev !== stat.dev || there.ino !== stat.ino || !(await stillSafe())) {
      await handle.close();
      return null;
    }
    return { handle, size: stat.size, mtime: stat.mtime };
  } catch (err) {
    await handle.close();
    throw err;
  }
}

/** Up to `length` bytes from `position`; fewer when the file ends first. */
async function readUpTo(handle: FileHandle, length: number, position = 0): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < bytes.length) {
    const { bytesRead } = await handle.read(bytes, read, bytes.length - read, position + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return bytes.subarray(0, read);
}

/**
 * The bytes of `file`, opened as `openSafe` says and read only up to the size it had when opened, so a file that grows
 * after the check never gets past `max`. Null when it is not safe to read; the size when it is too big.
 */
export async function readCapped(file: string, max: number, stillSafe: () => Promise<boolean>): Promise<CappedRead> {
  const open = await openSafe(file, stillSafe);
  if (!open) return null;
  try {
    if (open.size > max) return { size: open.size };
    return { bytes: await readUpTo(open.handle, open.size), mtime: open.mtime };
  } finally {
    await open.handle.close();
  }
}

const HASH_CHUNK = 64 * 1024;

/**
 * The first `max` bytes of `file` and its whole size, with `readCapped`'s checks (file-timeline spec §4.2 "Large
 * files"). When `wantOid(size)` holds, also git's blob id of the whole file, hashed a chunk at a time past `max`, so
 * only the prefix is ever held.
 */
export async function readPrefix(file: string, max: number, stillSafe: () => Promise<boolean>, wantOid?: (size: number) => boolean): Promise<PrefixRead> {
  const open = await openSafe(file, stillSafe);
  if (!open) return null;
  try {
    const bytes = await readUpTo(open.handle, Math.min(open.size, max));
    if (!wantOid?.(open.size)) return { bytes, size: open.size };
    const hash = createHash("sha1").update(`blob ${open.size}\0`).update(bytes);
    let at = bytes.length;
    while (at < open.size) {
      const chunk = await readUpTo(open.handle, Math.min(HASH_CHUNK, open.size - at), at);
      if (chunk.length === 0) break;
      hash.update(chunk);
      at += chunk.length;
    }
    // A file that shrank while it was read has no id for the size it had.
    return at === open.size ? { bytes, size: open.size, oid: hash.digest("hex") } : { bytes, size: open.size };
  } finally {
    await open.handle.close();
  }
}
