import { promises as fs } from "node:fs";

/** Creates the user folder. Copies the seed only if the folder has no content yet. Returns whether the seed was copied. */
export async function prepareFolder(folder: string, seed?: string): Promise<boolean> {
  await fs.mkdir(folder, { recursive: true });
  const entries = (await fs.readdir(folder)).filter((e) => e !== ".harness" && e !== ".DS_Store");
  if (!seed || entries.length > 0) return false;
  await fs.cp(seed, folder, { recursive: true });
  return true;
}
