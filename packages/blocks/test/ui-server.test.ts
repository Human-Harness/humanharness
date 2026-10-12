import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type BlockMessage, type Bridge, devLauncher, openBridge, uiServerSpec } from "../src";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");

let bridge: Bridge | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await bridge?.close();
});

async function connect(received: BlockMessage[]) {
  bridge = await openBridge((m) => received.push(m));
  const spec = uiServerSpec({ harnessConfig: FIXTURE, bridge: { path: bridge.path, token: bridge.token }, launcher: devLauncher() });
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
  it("exposes one tool per block, the core blocks included", async () => {
    const c = await connect([]);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["save_note", "show_choices", "show_note", "update_progress"]);
    expect(tools.find((t) => t.name === "show_note")?.description).toContain("note");
  });

  it("forwards a save_note call under the block's name", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received);
    const note = { title: "T", summary: ["a"], decisions: [], files: [], open: [] };
    const result = await c.callTool({ name: "save_note", arguments: note });
    expect(result.isError).toBeFalsy();
    expect(received).toEqual([{ name: "save_note", data: note }]);
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

describe("launchers", () => {
  it("runs Electron as Node and lets the caller choose the ui server entry", async () => {
    const { electronLauncher, uiServerSpec: spec } = await import("../src");
    const launcher = electronLauncher("/Applications/Demo.app/Contents/MacOS/Demo");
    expect(launcher).toEqual({ command: "/Applications/Demo.app/Contents/MacOS/Demo", args: [], env: { ELECTRON_RUN_AS_NODE: "1" } });
    const s = spec({ harnessConfig: "/x/harness.js", bridge: { path: "/b", token: "t" }, launcher, entry: "/x/ui-server.js" });
    expect(s.args).toEqual(["/x/ui-server.js"]);
    expect(s.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1", HH_HARNESS: "/x/harness.js" });
  });
});
