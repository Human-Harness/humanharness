import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanRepo } from "../test/style-guard-lib";

const out = join(import.meta.dirname, "../test/style-guard-offenders.json");
if (existsSync(out)) {
  console.error("The offenders list exists: it may only shrink, by hand.");
  process.exit(1);
}
writeFileSync(out, JSON.stringify(scanRepo(), null, 2) + "\n");
