import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type Rpc, devLauncher, openRpc, toolsServerSpec } from "../src";
import { toolMetaSchema } from "@humanharness/harness-sdk";
import { TOOLS_CALL_TIMEOUT_MS, TOOLS_CATALOGUE_LIMITS, createToolsServer, readToolsCatalogue } from "../src/tools-server";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tools-srv-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await client?.close();
  await rpc?.close();
  client = rpc = undefined;
});

const count = {
  name: "count-notes",
  description: "Counts the notes in the folder that carry a tag.",
  inputSchema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
};
const ci = { name: "pr-ci", description: "Reads the CI status of a pull request.", inputSchema: { type: "object", properties: { pr: { type: "integer" } } } };

function write(content: unknown): string {
  const file = path.join(fs.mkdtempSync(path.join(root, "c-")), "catalogue.json");
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

/** The server in process, linked to a client; `handler` is the app's side of the rpc. */
async function connect(catalogue: unknown, handler: (r: unknown) => Promise<unknown>) {
  rpc = await openRpc(handler);
  const server = await createToolsServer(write(catalogue), { path: rpc.path, token: rpc.token });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(b);
  return client;
}

describe("tools MCP server (tools spec §5)", () => {
  it("lists only agent: call tools, named by their ids, with params as the input schema and the description", async () => {
    // The app writes only agent: "call" tools to the catalogue (T7); the server lists exactly what it holds.
    const c = await connect([count, ci], async () => null);
    const { tools } = await c.listTools();
    expect(tools).toEqual([
      { name: "count-notes", description: count.description, inputSchema: count.inputSchema },
      { name: "pr-ci", description: ci.description, inputSchema: ci.inputSchema },
    ]);
  });

  it("a call goes to the rpc as { tool, args } and the result comes back as JSON text", async () => {
    const seen: unknown[] = [];
    const c = await connect([count], async (r) => (seen.push(r), { count: 3, tags: ["a"] }));
    const res = await c.callTool({ name: "count-notes", arguments: { tag: "a" } });
    expect(seen).toEqual([{ tool: "count-notes", args: { tag: "a" } }]);
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: JSON.stringify({ count: 3, tags: ["a"] }) }]);
  });

  it("a call with no arguments sends {}", async () => {
    const seen: unknown[] = [];
    const c = await connect([ci], async (r) => (seen.push(r), null));
    const res = await c.callTool({ name: "pr-ci" });
    expect(seen).toEqual([{ tool: "pr-ci", args: {} }]);
    expect(res.content).toEqual([{ type: "text", text: "null" }]);
  });

  it("an rpc refusal comes back as isError with the message", async () => {
    const c = await connect([count], async () => {
      throw new Error("count-notes failed · The folder is locked");
    });
    const res = await c.callTool({ name: "count-notes", arguments: { tag: "a" } });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "count-notes failed · The folder is locked" }]);
  });

  it("a tool the catalogue doesn't hold is an error and never reaches the app", async () => {
    const seen: unknown[] = [];
    const c = await connect([count], async (r) => void seen.push(r));
    const res = await c.callTool({ name: "pr-ci", arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: 'No tool "pr-ci"' }]);
    expect(seen).toEqual([]);
  });

  it("waits 180 s for the app, longer than the longest tool timeout, so the app's own timeout answers first", () => {
    expect(TOOLS_CALL_TIMEOUT_MS).toBe(180_000);
    expect(TOOLS_CALL_TIMEOUT_MS).toBeGreaterThan((toolMetaSchema.shape.timeout.maxValue ?? Infinity) * 1000);
    expect(toolMetaSchema.shape.timeout.maxValue).toBe(120);
  });

  it("an app that doesn't answer in 180 s: the agent reads that the tool may still have run", async () => {
    let reached!: () => void;
    const atApp = new Promise<void>((r) => (reached = r));
    const c = await connect([count], () => (reached(), new Promise(() => {})));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let done = false;
      // The client's own request timeout stays out of the way.
      const call = c.callTool({ name: "count-notes", arguments: { tag: "a" } }, undefined, { timeout: 600_000 }).finally(() => (done = true));
      await atApp;
      vi.advanceTimersByTime(TOOLS_CALL_TIMEOUT_MS - 1);
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      expect(done).toBe(false);
      vi.advanceTimersByTime(1);
      const res = await call;
      expect(res.isError).toBe(true);
      expect(res.content).toEqual([{ type: "text", text: "The app did not answer in time; the tool may still have run." }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an app that can't be reached is an error the agent reads", async () => {
    const c = await connect([count], async () => null);
    await rpc!.close();
    const res = await c.callTool({ name: "count-notes", arguments: { tag: "a" } });
    expect(res.isError).toBe(true);
    expect(String((res.content as { text: string }[])[0].text)).toMatch(/^Could not reach the app/);
  });
});

describe("readToolsCatalogue: caps, each entry checked", () => {
  it("reads the catalogue file with caps (≤ 512 KB, ≤ 50 tools, each checked); a broken file gives no tools, logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readToolsCatalogue(write([count, ci]))).toEqual([count, ci]);
    expect(log).not.toHaveBeenCalled();

    // Broken files: none, each logged with a fixed line.
    expect(await readToolsCatalogue(path.join(root, "missing.json"))).toEqual([]);
    expect(await readToolsCatalogue(write("{not json"))).toEqual([]);
    expect(await readToolsCatalogue(write({ tools: [count] }))).toEqual([]);
    expect(await readToolsCatalogue(write(`[${JSON.stringify(count)}]${" ".repeat(TOOLS_CATALOGUE_LIMITS.bytes)}`))).toEqual([]);
    const many = Array.from({ length: TOOLS_CATALOGUE_LIMITS.tools + 1 }, (_, i) => ({ ...count, name: `t${i}` }));
    expect(await readToolsCatalogue(write(many))).toEqual([]);
    expect(await readToolsCatalogue(root)).toEqual([]);
    expect(log).toHaveBeenCalledTimes(6);
    for (const [line] of log.mock.calls) expect(line).toMatch(/^The tools catalogue was ignored: /);
    // The file's text never reaches the log.
    expect(log.mock.calls.flat().join("\n")).not.toContain("not json");
  });

  it("exactly 50 tools are read", async () => {
    const fifty = Array.from({ length: TOOLS_CATALOGUE_LIMITS.tools }, (_, i) => ({ ...count, name: `t${i}` }));
    expect(await readToolsCatalogue(write(fifty))).toHaveLength(50);
  });

  it("an entry that doesn't fit is dropped and logged; the others stay", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = [
      { ...count, name: "Bad Name" },
      { ...count, name: "x".repeat(65) },
      { ...count, name: "__proto__" },
      { ...count, description: "" },
      { ...count, description: "x".repeat(TOOLS_CATALOGUE_LIMITS.description + 1) },
      { ...count, description: 3 },
      { ...count, inputSchema: { type: "array" } },
      { ...count, inputSchema: [] },
      { name: "no-schema", description: "A tool with no input schema at all." },
      { ...count, extra: true },
      "count-notes",
      null,
    ];
    expect(await readToolsCatalogue(write([...bad, ci, { ...ci, description: "A second pr-ci keeps the first one only." }]))).toEqual([ci]);
    expect(log).toHaveBeenCalledTimes(bad.length + 1);
    for (const [line] of log.mock.calls) expect(line).toBe("A tools catalogue entry was dropped");
  });
});

describe("toolsServerSpec", () => {
  it("is named tools and carries the catalogue and the rpc in its env", () => {
    const spec = toolsServerSpec({ catalogue: "/c/tools.json", rpc: { path: "/s/rpc.sock", token: "tok" }, launcher: { command: "node", args: ["--x"], env: { A: "1" } }, entry: "/out/tools-server.js" });
    expect(spec).toEqual({ name: "tools", command: "node", args: ["--x", "/out/tools-server.js"], env: { A: "1", HH_TOOLS: "/c/tools.json", HH_RPC: "/s/rpc.sock", HH_RPC_TOKEN: "tok" } });
  });

  it("defaults to the TypeScript bin (dev)", async () => {
    const spec = toolsServerSpec({ catalogue: "/c/tools.json", rpc: { path: "/s", token: "t" }, launcher: devLauncher() });
    expect(path.basename(spec.args.at(-1)!)).toBe("tools-server-bin.ts");
    expect(fs.existsSync(spec.args.at(-1)!)).toBe(true);
  });
});
