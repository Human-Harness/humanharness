import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockMessage, type Bridge, devLauncher, openBridge, uiServerSpec } from "../src";

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../harnesses/demo/harness.config.ts");

let bridge: Bridge | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await bridge?.close();
});

async function connect(received: BlockMessage[]) {
  bridge = await openBridge((m) => received.push(m));
  const spec = uiServerSpec({ harnessConfig: DEMO, bridge: { path: bridge.path, token: bridge.token }, launcher: devLauncher() });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...(process.env as Record<string, string>), ...spec.env },
    }),
  );
  return client;
}

describe("ui MCP server", () => {
  it("exposes one tool per block", async () => {
    const c = await connect([]);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["show_note", "update_progress"]);
    expect(tools.find((t) => t.name === "show_note")?.description).toContain("note");
  });

  it("forwards valid calls through the bridge", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received);
    const result = await c.callTool({ name: "show_note", arguments: { title: "Hello", body: "World" } });
    expect(result.isError).toBeFalsy();
    expect(received).toEqual([{ name: "note", data: { title: "Hello", body: "World" } }]);
  });

  it("returns a tool error when the bridge is down", async () => {
    const c = await connect([]);
    await bridge?.close();
    const result = await c.callTool({ name: "show_note", arguments: { title: "Hello", body: "World" } });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0].text;
    expect(text).toMatch(/^Could not reach the app \(.+\)\. The person did not see this; do not retry in a loop\.$/);
  });

  it("rejects calls that break the schema and forwards nothing", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received);
    const result = await c
      .callTool({ name: "update_progress", arguments: { percent: 500 } })
      .catch(() => ({ isError: true }));
    expect(result.isError).toBe(true);
    expect(received).toEqual([]);
  });
});
