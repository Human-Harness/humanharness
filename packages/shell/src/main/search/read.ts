import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { MAX_TEXT_BYTES } from "@humanharness/search";
import { isBinary, readCapped } from "@humanharness/workspace";

/** `file`'s folder still resolves inside `realRoot` (checked right before a read: a folder above may have been swapped for a link). */
export async function stillInside(file: string, realRoot: string): Promise<boolean> {
  const dir = await fs.realpath(path.dirname(file)).catch(() => null);
  return dir !== null && (dir === realRoot || dir.startsWith(realRoot + path.sep));
}

/** A text file's contents through `readCapped` (no link, no hard link, inside its root); null when binary, too big or unsafe. */
export async function readText(root: string, rel: string): Promise<string | null> {
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) return null;
  const file = path.join(root, rel);
  const got = await readCapped(file, MAX_TEXT_BYTES, () => stillInside(file, realRoot)).catch(() => null);
  if (!got || !("bytes" in got) || isBinary(rel, got.bytes)) return null;
  return got.bytes.toString("utf8");
}

/** The most bytes one read of a chat file takes; the rest waits for the next reconcile. */
export const MAX_CHAT_READ = 32 * 1024 * 1024;
/** The longest chat line a snippet reads. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/** Opens a file inside `realRoot` without following a link; null unless it is a plain file with one name. */
async function openPlain(file: string, realRoot: string) {
  if (!(await stillInside(file, realRoot))) return null;
  const h = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!h) return null;
  const st = await h.stat().catch(() => null);
  if (!st?.isFile() || st.nlink > 1) {
    await h.close();
    return null;
  }
  return { h, size: st.size };
}

async function readAt(h: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const { bytesRead } = await h.read(buf, got, length - got, position + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/**
 * A chat file's whole lines from byte `from` on (from 0 when the file got shorter: it was replaced). `end`: the byte
 * after the last newline read, where the next read starts. Null when the file can't be read safely.
 */
export async function readChatFrom(file: string, realRoot: string, from: number): Promise<{ lines: { offset: number; length: number; line: string }[]; end: number; reset: boolean } | null> {
  const open = await openPlain(file, realRoot);
  if (!open) return null;
  try {
    const reset = open.size < from;
    const start = reset ? 0 : from;
    const buf = await readAt(open.h, start, Math.min(open.size - start, MAX_CHAT_READ));
    const lines: { offset: number; length: number; line: string }[] = [];
    let at = 0;
    for (;;) {
      const nl = buf.indexOf(10, at);
      if (nl < 0) break;
      lines.push({ offset: start + at, length: nl - at, line: buf.subarray(at, nl).toString("utf8") });
      at = nl + 1;
    }
    return { lines, end: start + at, reset };
  } finally {
    await open.h.close();
  }
}

/** One chat entry's text, read at its byte offset (§5.3); null when it can't be read or isn't an entry. */
export async function readChatEntry(base: string, rel: string, offset: number, length: number): Promise<string | null> {
  const realRoot = await fs.realpath(base).catch(() => null);
  if (!realRoot || length > MAX_ENTRY_BYTES) return null;
  const open = await openPlain(path.join(base, rel), realRoot);
  if (!open) return null;
  try {
    const parsed: unknown = JSON.parse((await readAt(open.h, offset, length)).toString("utf8"));
    return parsed && typeof parsed === "object" && typeof (parsed as { text?: unknown }).text === "string" ? (parsed as { text: string }).text : null;
  } catch {
    return null;
  } finally {
    await open.h.close();
  }
}
