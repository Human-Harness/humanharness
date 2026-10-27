import JSZip from "jszip";
import { MaterialRefused } from "../blocks";
import { ZIP_MAX_ENTRIES, ZIP_MAX_ENTRY, ZIP_MAX_TOTAL } from "../constants";

/** How much a zip container may hold: entries, uncompressed bytes in all, uncompressed bytes per entry. */
export interface ZipLimits {
  entries: number;
  total: number;
  entry: number;
}
export const ZIP_LIMITS: ZipLimits = { entries: ZIP_MAX_ENTRIES, total: ZIP_MAX_TOTAL, entry: ZIP_MAX_ENTRY };

/** Each opened zip's limits and the bytes inflated from it so far. */
const budgets = new WeakMap<JSZip, { limits: ZipLimits; inflated: number }>();

/** An entry's size as the archive declares it (JSZip keeps it on its internal compressed object). */
const declared = (f: JSZip.JSZipObject): number => {
  const size = (f as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  return typeof size === "number" && size > 0 ? size : 0;
};

/**
 * Opens a zip the person gave, refusing a zip bomb before anything is inflated: too many entries, or declared sizes
 * above the limits. Declared sizes can lie, so every read through `zipBytes`/`zipText` also counts what it inflates.
 */
export async function openZip(buf: Buffer, limits: ZipLimits = ZIP_LIMITS): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > limits.entries) throw new MaterialRefused("unreadable");
  let total = 0;
  for (const f of files) {
    const size = declared(f);
    total += size;
    if (size > limits.entry || total > limits.total) throw new MaterialRefused("unreadable");
  }
  budgets.set(zip, { limits, inflated: 0 });
  return zip;
}

/** One entry's bytes, inflated with a running count: past the entry's or the archive's limit it is refused. */
export async function zipBytes(zip: JSZip, name: string): Promise<Buffer | null> {
  const file = zip.file(name);
  if (!file || file.dir) return null;
  return inflate(zip, file, true);
}

/** One entry as UTF-8 text (a byte order mark dropped). */
export async function zipText(zip: JSZip, name: string): Promise<string | null> {
  const bytes = await zipBytes(zip, name);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/**
 * For a library that inflates the zip itself (mammoth, exceljs): opens the zip with the guard and inflates every
 * entry once, counting and keeping nothing, so the library only ever reads a zip whose real sizes are within limits.
 */
export async function checkZip(buf: Buffer, limits: ZipLimits = ZIP_LIMITS): Promise<void> {
  const zip = await openZip(buf, limits);
  for (const f of Object.values(zip.files)) if (!f.dir) await inflate(zip, f, false);
}

function inflate(zip: JSZip, file: JSZip.JSZipObject, keep: boolean): Promise<Buffer> {
  // A zip opened without `openZip` (never in this package) still gets the default limits.
  const budget = budgets.get(zip) ?? { limits: ZIP_LIMITS, inflated: 0 };
  budgets.set(zip, budget);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const stream = file.nodeStream("nodebuffer");
    const fail = () => {
      if (done) return;
      done = true;
      stream.removeAllListeners("data");
      stream.pause();
      reject(new MaterialRefused("unreadable"));
    };
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      budget.inflated += chunk.length;
      if (size > budget.limits.entry || budget.inflated > budget.limits.total) return fail();
      if (keep) chunks.push(chunk);
    });
    // JSZip reports a corrupt entry (a bad CRC, a size that doesn't match the declared one) as an error.
    stream.on("error", fail);
    stream.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
  });
}
