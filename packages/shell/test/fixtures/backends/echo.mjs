// A test backend: answers echo, init?, stream, fail, noise and bye (hatches spec §4.2).
import { createInterface } from "node:readline";

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
let init = null;

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "init") init = msg.params;
  else if (msg.method === "echo") send({ id: msg.id, result: msg.params });
  else if (msg.method === "init?") send({ id: msg.id, result: init });
  else if (msg.method === "stream") {
    for (let i = 0; i < msg.params.n; i++) send({ method: "tick", params: { i } });
    send({ id: msg.id, result: { sent: msg.params.n } });
  } else if (msg.method === "fail") send({ id: msg.id, error: { code: 1, message: "nope" } });
  else if (msg.method === "noise") {
    process.stderr.write("hello from stderr\n");
    process.stdout.write("not json\n");
    process.stdout.write(`${JSON.stringify({ id: msg.id, result: "no jsonrpc" })}\n`);
    send({ id: 99_999, result: "not ours" });
    send({ id: msg.id, result: "done" });
  } else if (msg.method === "bye") {
    // A last event without its newline, then gone.
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "tick", params: { last: true } }), () => process.exit(0));
  }
});
