import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentToolDefinition, type Bridge, type Rpc, RpcRefused, RpcTimeout, agentToolError, devLauncher, openBridge, openRpc, uiServerSpec } from "../src";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
let bridge: Bridge | undefined;
let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  await bridge?.close();
  client = rpc = bridge = undefined;
});

const text = { type: "string", maxLength: 10 };
const DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "ask_person",
    description: "Asks.",
    tasksOnly: true,
    inputSchema: {
      type: "object",
      properties: { question: text, options: { type: "array", items: { type: "object", properties: { label: text }, required: ["label"] } } },
      required: ["question"],
    },
  },
  { name: "read_state", description: "Reads.", inputSchema: { type: "object", properties: { path: text }, required: ["path"] } },
];

async function connect(handler?: (r: unknown) => Promise<unknown>, job = false) {
  bridge = await openBridge(() => {});
  if (handler) rpc = await openRpc(handler);
  const spec = uiServerSpec({ harnessConfig: FIXTURE, bridge, ...(rpc ? { tools: { definitions: DEFINITIONS, rpc } } : {}), launcher: devLauncher() });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env, HH_JOB: job ? "1" : "" } }));
  return { client, spec, names: async () => (await client!.listTools()).tools.map((t) => t.name) };
}

describe("the ui server's tools from the caller", () => {
  it("are listed with their channel, and each call is sent with its tool's name and the declared arguments only", async () => {
    const seen: unknown[] = [];
    const { client, names } = await connect(async (r) => {
      seen.push(r);
      return { id: "c1" };
    });
    expect(await names()).toEqual(expect.arrayContaining(["ask_person", "read_state"]));
    // `tool` and the keys the schema does not declare, nested too, never reach the app.
    const res = await client.callTool({ name: "ask_person", arguments: { question: "Q?", options: [{ label: "A", extra: 1 }], tool: "read_state" } });
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: '{"id":"c1"}' }]);
    expect(seen).toEqual([{ tool: "ask_person", args: { question: "Q?", options: [{ label: "A" }] } }]);
  });

  it("a job lists those that are not `tasksOnly`", async () => {
    const { names } = await connect(async () => null, true);
    const listed = await names();
    expect(listed).toContain("read_state");
    expect(listed).not.toContain("ask_person");
  });

  it("are not listed without a channel, and the spec sets no channel variables (D0)", async () => {
    const { spec, names } = await connect();
    expect(Object.keys(spec.env).filter((k) => k.startsWith("HH_TOOLS_RPC"))).toEqual([]);
    const listed = await names();
    expect(listed).not.toContain("ask_person");
    expect(listed).not.toContain("read_state");
  });

  it("a refusal is a tool error with the app's message, and input the schema refuses never reaches the app", async () => {
    const seen: unknown[] = [];
    const { client } = await connect(async (r) => {
      seen.push(r);
      throw new Error("options: 2 to 5");
    });
    const res = await client.callTool({ name: "read_state", arguments: { path: "a.md" } });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "options: 2 to 5" }]);
    const long = await client.callTool({ name: "read_state", arguments: { path: "x".repeat(11) } });
    expect(long.isError).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("a timeout says what the tool declares; other failures never show their text", () => {
    expect(agentToolError(new RpcRefused("options: 2 to 5"))).toBe("options: 2 to 5");
    expect(agentToolError(new RpcTimeout(), "Check first")).toBe("Check first");
    expect(agentToolError(new RpcTimeout())).toBe("The app did not answer. Do not retry in a loop.");
    const generic = agentToolError(new Error("connect ENOENT /tmp/hh-rpc-secret.sock"));
    expect(generic).not.toContain("/tmp");
    expect(generic).toContain("Could not reach the app");
  });
});
