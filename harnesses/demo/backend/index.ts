import type { BackendInit } from "@humanharness/harness-sdk";
import { createInterface } from "node:readline";

// The demo's backend (hatches spec §4): answers `echo` and streams `tick` events, so the demo can show the protocol.
// It runs on Electron's Node, which strips the types itself: erasable syntax only, and `import type` from the SDK.
// Every line carries "jsonrpc": "2.0": the app drops a line without it.
let init: BackendInit | null = null;
const send = (msg: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let msg: { id?: number; method?: string; params?: unknown };
  try {
    msg = JSON.parse(line);
  } catch {
    process.stderr.write("A line that isn't JSON\n");
    return;
  }
  // The app's notifications: `init` once at launch, `scopesChanged` with the same shape after.
  if (msg.method === "init" || msg.method === "scopesChanged") {
    init = msg.params as BackendInit;
    return;
  }
  if (msg.id === undefined) return;
  const id = msg.id;
  if (msg.method === "echo") return void send({ id, result: { echo: msg.params, mock: init?.mock ?? false } });
  if (msg.method === "stream") {
    const n = Math.min(Number((msg.params as { n?: unknown } | null)?.n) || 3, 20);
    let i = 0;
    const timer = setInterval(() => {
      send({ method: "tick", params: { i } });
      if (++i >= n) {
        clearInterval(timer);
        send({ id, result: { sent: n } });
      }
    }, 50);
    return;
  }
  send({ id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
});
