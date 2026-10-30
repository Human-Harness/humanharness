// A test backend that sends 1000 events at once on init, then idles.
import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
  if (JSON.parse(line).method !== "init") return;
  let out = "";
  for (let i = 0; i < 1000; i++) out += `${JSON.stringify({ jsonrpc: "2.0", method: "tick", params: { i } })}\n`;
  process.stdout.write(out);
});
