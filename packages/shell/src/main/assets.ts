import { promises as fs } from "node:fs";
import path from "node:path";

const TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** An image file as a data: URL for the renderer (its CSP allows `img-src data:`). Null when missing or not an image. */
export async function imageDataUrl(file: string): Promise<string | null> {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return null;
  try {
    return `data:${type};base64,${(await fs.readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}
