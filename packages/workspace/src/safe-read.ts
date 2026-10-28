import { constants, promises as fs } from "node:fs";

/** What `readCapped` found: the bytes, the size when it is over the cap, or null when the file is not safe to read. */
export type CappedRead = { bytes: Buffer; mtime: Date } | { size: number } | null;

/**
 * The bytes of `file`, checked with `stillSafe` right before it is opened, opened without following a link and without
 * blocking (a FIFO swapped in can't hang the process), checked again once open (the handle is still the file at that
 * path, and `stillSafe` still holds), and read only up to the size it had when opened, so a file that grows after the
 * check never gets past `max`. Null when it is no longer safe, not a regular file, or a hard link (`nlink > 1`: its
 * other names may be anywhere); the size when it is too big.
 */
export async function readCapped(file: string, max: number, stillSafe: () => Promise<boolean>): Promise<CappedRead> {
  if (!(await stillSafe())) return null;
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1) return null;
    const there = await fs.stat(file).catch(() => null);
    if (!there || there.dev !== stat.dev || there.ino !== stat.ino || !(await stillSafe())) return null;
    if (stat.size > max) return { size: stat.size };
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await handle.read(bytes, read, bytes.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return { bytes: bytes.subarray(0, read), mtime: stat.mtime };
  } finally {
    await handle.close();
  }
}
