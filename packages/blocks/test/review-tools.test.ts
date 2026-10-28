import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type Bridge, type Rpc, devLauncher, openBridge, openRpc, uiServerSpec } from "../src";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
let bridge: Bridge | undefined;
let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  await bridge?.close();
});

async function connect(handler: (r: unknown) => Promise<unknown>) {
  bridge = await openBridge(() => {});
  rpc = await openRpc(handler);
  const spec = uiServerSpec({ harnessConfig: FIXTURE, bridge, review: { path: rpc.path, token: rpc.token }, launcher: devLauncher() });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("review tools", () => {
  it("are listed with a review channel, and forward each call", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return { id: "c1" };
    });
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["ask_in_document", "reply_to_comment", "read_review"]));
    const args = { path: "a.md", quote: "x", question: "Q?", options: [{ label: "A", text: "x" }, { label: "B", text: "y" }] };
    const res = await c.callTool({ name: "ask_in_document", arguments: args });
    expect(res.isError).toBeFalsy();
    expect((res.content as { text: string }[])[0].text).toBe('{"id":"c1"}');
    expect(seen).toEqual([{ op: "ask", ...args }]);
  });

  it("are not listed without a review channel, and the spec sets no review variables (D0)", async () => {
    bridge = await openBridge(() => {});
    const spec = uiServerSpec({ harnessConfig: FIXTURE, bridge, launcher: devLauncher() });
    expect(Object.keys(spec.env).filter((k) => k.startsWith("HH_REVIEW"))).toEqual([]);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("ask_in_document");
    expect(names).not.toContain("reply_to_comment");
    expect(names).not.toContain("read_review");
  });

  it("a refusal is a tool error with the app's message; one option still reaches the app, which says 2 to 5", async () => {
    const c = await connect(async () => {
      throw new Error("options: 2 to 5");
    });
    const res = await c.callTool({ name: "ask_in_document", arguments: { path: "a.md", quote: "x", question: "Q?", options: [{ label: "A", text: "x" }] } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toBe("options: 2 to 5");
  });
});
