import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The folder names under `harnesses/` whose manifest has `release: true` (release spec §3.3), sorted. */
export async function releaseHarnesses(harnessesDir: string): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of fs.readdirSync(harnessesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const config = path.join(harnessesDir, entry.name, "harness.config.ts");
    if (!fs.existsSync(config)) continue;
    const mod = await import(pathToFileURL(config).href);
    if (mod.default?.release === true) ids.push(entry.name);
  }
  return ids.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ids = await releaseHarnesses(fileURLToPath(new URL("../harnesses", import.meta.url)));
  if (ids.length === 0) {
    console.error("No harness has release: true");
    process.exit(1);
  }
  console.log(JSON.stringify(ids));
}
