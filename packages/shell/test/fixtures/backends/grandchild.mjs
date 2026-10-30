// A test backend that starts a grandchild sharing its stdout; the grandchild sends a tick every 100 ms.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const tick = "setInterval(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'tick', params: { from: 'grandchild' } }) + '\\n'), 100)";
const grandchild = spawn(process.execPath, ["-e", tick], { stdio: ["ignore", "inherit", "inherit"] });

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "pid") process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: grandchild.pid })}\n`);
  else if (msg.method === "leave") process.exit(0);
});
