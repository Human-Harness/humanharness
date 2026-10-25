import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadHarness } from "@humanharness/harness-sdk";
import { type Rpc, agentCollections, dataServerSpec, devLauncher, hasAgentData, openRpc } from "../src";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures");
const STUDY = path.join(fixtures, "data-harness", "harness.config.ts");

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  client = undefined;
  rpc = undefined;
});

async function connect(handler: (request: unknown) => Promise<unknown>) {
  rpc = await openRpc(handler);
  const spec = dataServerSpec({ harnessConfig: STUDY, rpc: { path: rpc.path, token: rpc.token }, launcher: devLauncher() });
  expect(spec.name).toBe("data");
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("agentCollections", () => {
  it("lists what the agent may see; a harness without data has none (D2)", async () => {
    expect(agentCollections(await loadHarness(STUDY)).map(([n]) => n)).toEqual(["concepts", "flashcards", "profile"]);
    expect(hasAgentData(await loadHarness(path.join(fixtures, "notes-harness", "harness.config.ts")))).toBe(false);
  });
});

describe("data MCP server", () => {
  it("offers reads for every visible collection and writes only for `write` ones", async () => {
    const c = await connect(async () => null);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["data_delete", "data_get", "data_patch", "data_put", "data_query"]);
    const enumOf = (name: string) => (tools.find((t) => t.name === name)?.inputSchema.properties?.collection as { enum: string[] }).enum;
    expect(enumOf("data_query")).toEqual(["concepts", "flashcards", "profile"]);
    expect(enumOf("data_put")).toEqual(["concepts"]);
    const query = tools.find((t) => t.name === "data_query")!.description!;
    expect(query).toContain("concepts");
    expect(query).not.toContain("secrets");
  });

  it("sends each call to the app as a request and returns its answer", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (request) => {
      seen.push(request);
      return { id: "halves", name: "Halves", state: "seen" };
    });
    const record = { id: "halves", name: "Halves", state: "seen", evidence: [] };
    const put = await c.callTool({ name: "data_put", arguments: { collection: "concepts", record } });
    expect(put.isError).toBeFalsy();
    expect((put.content as { text: string }[])[0].text).toContain('"halves"');
    await c.callTool({ name: "data_query", arguments: { collection: "concepts", where: { state: "seen" }, limit: 5 } });
    expect(seen).toEqual([
      { op: "put", collection: "concepts", record },
      { op: "query", collection: "concepts", where: { state: "seen" }, limit: 5 },
    ]);
  });

  it("returns the app's refusal as a tool error", async () => {
    const c = await connect(async () => {
      throw new Error("The state can rise only with a new evidence entry");
    });
    const r = await c.callTool({ name: "data_patch", arguments: { collection: "concepts", key: "halves", patch: { state: "mastered" } } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toBe("Refused: The state can rise only with a new evidence entry");
  });
});
