// A searchable collection's stamp (search spec D4), for plugin and harness sources alike.
import { promises as fs } from "node:fs";
import { type RecordSearch, declarationStamp } from "@humanharness/search";

/**
 * Each file's size and mtime (`none` while it doesn't exist), then the declaration's hash. Pass the records file and its
 * meta file: a store writes the records first and the meta (when each changed) after, so a read between the two still
 * ends with a stamp the second write changes. `label`: what the documents carry beside the records (a plugin's name),
 * hashed in after the declaration, so a change to it builds them again.
 */
export async function sourceStamp(files: readonly string[], decl: RecordSearch, label?: string): Promise<string> {
  const parts = await Promise.all(
    files.map(async (f) => {
      const st = await fs.lstat(f).catch(() => null);
      return st ? `${st.size}:${st.mtimeMs}` : "none";
    }),
  );
  return `${parts.join("|")}#${declarationStamp(decl)}${label === undefined ? "" : textHash(label)}`;
}

/** FNV-1a, base 36, as `declarationStamp`. */
function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
