// A test backend that tells where it runs and which HH_ variables it got.
import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method !== "whereami") return;
  const result = { cwd: process.cwd(), env: Object.keys(process.env).filter((k) => k.startsWith("HH_")), pid: process.pid };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
});
