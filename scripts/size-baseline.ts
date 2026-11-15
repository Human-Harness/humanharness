import fs from "node:fs";
import { baselineFile, lowered, readBaseline, sizeOrNull } from "../packages/protocol/test/file-size.ts";

const before = readBaseline();
const after = lowered(before, sizeOrNull);
fs.writeFileSync(baselineFile, JSON.stringify(after, null, 2) + "\n");
for (const [f, n] of Object.entries(before)) {
  if (!(f in after)) console.log(`dropped  ${f}`);
  else if (after[f] < n) console.log(`lowered  ${f}  ${n} → ${after[f]}`);
}
