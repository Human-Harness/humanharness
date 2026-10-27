import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type Rpc, devLauncher, openRpc } from "@humanharness/blocks";
import { afterEach, describe, expect, it } from "vitest";
import { materialServerSpec } from "../src";

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  client = undefined;
  rpc = undefined;
});

async function connect(handler: (r: unknown) => Promise<unknown>, mode: "person" | "system" = "person", tools: string[] = []) {
  rpc = await openRpc(handler);
  const spec = materialServerSpec({ rpc: { path: rpc.path, token: rpc.token }, launcher: devLauncher(), mode, tools });
  expect(spec.name).toBe("material");
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("material MCP server", () => {
  it("person mode: read, search and flag, each sent to the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return (r as { op: string }).op === "read" ? "[[frag:a-001]] a.pdf, p.1\n\nText" : [{ id: "a-001", where: "a.pdf, p.1", summary: "S." }];
    });
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(["material_conflict", "material_flag", "material_read", "material_search"]);
    const read = await c.callTool({ name: "material_read", arguments: { id: "a-001" } });
    expect((read.content as { text: string }[])[0].text).toContain("Text");
    await c.callTool({ name: "material_search", arguments: { query: "fractions" } });
    await c.callTool({ name: "material_flag", arguments: { id: "a-001", reason: "Broken table" } });
    expect(seen).toEqual([{ op: "read", id: "a-001" }, { op: "search", query: "fractions" }, { op: "flag", id: "a-001", reason: "Broken table" }]);
  });

  it("a refusal comes back as a tool error", async () => {
    const c = await connect(async () => {
      throw new Error("This task has no material");
    });
    const r = await c.callTool({ name: "material_read", arguments: { id: "a-001" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toBe("Refused: This task has no material");
  });

  it("a bad id is refused by the server before any call to the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return "x";
    });
    const r = await c.callTool({ name: "material_read", arguments: { id: "../x" } });
    expect(r.isError).toBe(true);
    expect(seen).toEqual([]);
  });

  it("system mode with no stage tools offers only reading", async () => {
    const c = await connect(async () => null, "system", []);
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(["material_read"]);
  });
});
