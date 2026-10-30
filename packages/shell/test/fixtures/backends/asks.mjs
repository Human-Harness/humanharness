// A test backend that asks the app to write the history, and writes the answer to stderr.
import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "init") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "x", method: "history.save", params: {} })}\n`);
  } else if (msg.id === "x") process.stderr.write(`answer: ${line}\n`);
});
