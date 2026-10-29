import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendInit } from "@humanharness/harness-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const ENTRY = path.join(ROOT, "backend", "index.ts");

interface Line {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * The demo's backend over stdio, as the app runs it (hatches Decision 2): plain Node, which strips the erasable
 * TypeScript itself, with the harness folder as cwd.
 */
function startEcho() {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [ENTRY], { cwd: ROOT, stdio: "pipe" });
  const lines: Line[] = [];
  const waiting: (() => void)[] = [];
  let gone = false;
  child.on("exit", () => {
    gone = true;
    for (const w of waiting.splice(0)) w();
  });
  createInterface({ input: child.stdout }).on("line", (l) => {
    lines.push(JSON.parse(l) as Line);
    for (const w of waiting.splice(0)) w();
  });
  const write = (msg: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  /** Resolves with every line seen once one answers `id`. */
  const answer = (id: number) =>
    new Promise<Line>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${id}`)), 10_000);
      const check = () => {
        const found = lines.find((l) => l.id === id);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        } else if (gone) {
          clearTimeout(timer);
          reject(new Error(`the backend exited before answering ${id}`));
        } else waiting.push(check);
      };
      check();
    });
  return { child, lines, write, answer };
}

const init = (mock: boolean): BackendInit => ({
  folder: "/tmp/demo-folder",
  scopes: [],
  language: "en",
  coreVersion: "0.1.0",
  dataDir: "/tmp/demo-data",
  mock,
});

let running: ChildProcessWithoutNullStreams | null = null;
afterEach(() => {
  running?.kill("SIGKILL");
  running = null;
});

describe("the demo's echo backend (hatches spec §4)", () => {
  it("answers echo with the params and the mock flag from init, every line JSON-RPC 2.0", async () => {
    const b = startEcho();
    running = b.child;
    b.write({ method: "init", params: init(true) });
    b.write({ id: 1, method: "echo", params: { text: "hello" } });
    const a = await b.answer(1);
    expect(a).toEqual({ jsonrpc: "2.0", id: 1, result: { echo: { text: "hello" }, mock: true } });
  });

  it("hears scopesChanged without answering it, and keeps the latest init", async () => {
    const b = startEcho();
    running = b.child;
    b.write({ method: "init", params: init(true) });
    b.write({ method: "scopesChanged", params: init(false) });
    b.write({ id: 2, method: "echo", params: "x" });
    expect((await b.answer(2)).result).toEqual({ echo: "x", mock: false });
    expect(b.lines).toHaveLength(1);
  });

  it("streams n tick events in order, then answers how many it sent", async () => {
    const b = startEcho();
    running = b.child;
    b.write({ method: "init", params: init(false) });
    b.write({ id: 3, method: "stream", params: { n: 3 } });
    expect((await b.answer(3)).result).toEqual({ sent: 3 });
    expect(b.lines.slice(0, 3)).toEqual([0, 1, 2].map((i) => ({ jsonrpc: "2.0", method: "tick", params: { i } })));
    expect(b.lines.every((l) => l.jsonrpc === "2.0")).toBe(true);
  });

  it("caps a stream at 20 ticks", async () => {
    const b = startEcho();
    running = b.child;
    b.write({ id: 4, method: "stream", params: { n: 1000 } });
    expect((await b.answer(4)).result).toEqual({ sent: 20 });
    expect(b.lines.filter((l) => l.method === "tick")).toHaveLength(20);
  });

  it("answers an unknown method with -32601 and skips a line that isn't JSON", async () => {
    const b = startEcho();
    running = b.child;
    b.child.stdin.write("not json\n");
    b.write({ id: 5, method: "nope" });
    expect(await b.answer(5)).toEqual({ jsonrpc: "2.0", id: 5, error: { code: -32601, message: "Unknown method nope" } });
  });
});
