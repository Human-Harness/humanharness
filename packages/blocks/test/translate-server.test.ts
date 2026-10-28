import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { type Rpc, RpcRefused, RpcTimeout, devLauncher, openRpc, translateServerSpec } from "../src";
import { saveErrorText } from "../src/translate-server";

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  client = rpc = undefined;
});

async function connect(handler: (r: unknown) => Promise<unknown>) {
  rpc = await openRpc(handler);
  const spec = translateServerSpec({ rpc: { path: rpc.path, token: rpc.token }, launcher: devLauncher() });
  expect(spec.name).toBe("translate");
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("translate server (spec §5)", () => {
  it("offers only save_translation, and passes the map to the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return "Saved 2.";
    });
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(["save_translation"]);
    const res = await c.callTool({ name: "save_translation", arguments: { strings: { "core:chat.send": "Enviar", "core:notes.keyPoints": { one: "1 punto", other: "{{count}} puntos" } } } });
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain("Saved 2.");
    expect(seen).toEqual([{ op: "save", strings: { "core:chat.send": "Enviar", "core:notes.keyPoints": { one: "1 punto", other: "{{count}} puntos" } } }]);
  });

  it("refuses an oversized or malformed save before it reaches the app", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => void seen.push(r));
    const save = async (strings: unknown) => (await c.callTool({ name: "save_translation", arguments: { strings } as Record<string, unknown> })).isError;
    expect(await save(Object.fromEntries(Array.from({ length: 151 }, (_, i) => [`core:k${i}`, "x"])))).toBe(true);
    expect(await save({ "core:a": "x".repeat(4001) })).toBe(true);
    expect(await save({ [`core:${"k".repeat(200)}`]: "x" })).toBe(true);
    expect(await save({ "": "x" })).toBe(true);
    expect(await save({ "core:a": { one: "x", lots: "y" } })).toBe(true);
    expect(await save({ "core:a": { one: "x".repeat(4001) } })).toBe(true);
    expect(await save({ "core:a": 3 })).toBe(true);
    expect(await save(["x"])).toBe(true);
    expect(await save("x")).toBe(true);
    // Every text is within bounds, but the whole save is too big for one turn.
    const plural = { zero: "x".repeat(4000), one: "x".repeat(4000), two: "x".repeat(4000), few: "x".repeat(4000), many: "x".repeat(4000), other: "x".repeat(4000) };
    expect(await save(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`core:k${i}`, plural])))).toBe(true);
    expect(seen).toEqual([]);
  });

  it("accepts a key of exactly 200 characters", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (r) => {
      seen.push(r);
      return "Saved 1.";
    });
    const key = `core:${"k".repeat(195)}`;
    expect(key).toHaveLength(200);
    const res = await c.callTool({ name: "save_translation", arguments: { strings: { [key]: "x" } } });
    expect(res.isError).toBeFalsy();
    expect(seen).toEqual([{ op: "save", strings: { [key]: "x" } }]);
  });

  it("a timeout has its own text: the batch may be saved, so don't call again", () => {
    expect(saveErrorText(new RpcTimeout())).toBe("The app did not answer in time; it may have saved this batch. Do not call again.");
    expect(saveErrorText(new RpcRefused("No batch is open"))).toBe("Refused: No batch is open");
    expect(saveErrorText(new Error("ECONNREFUSED"))).toBe("Could not reach the app (ECONNREFUSED). Do not retry in a loop.");
  });

  it("an app refusal comes back as a tool error the agent reads", async () => {
    const c = await connect(async () => {
      throw new Error("No batch is open");
    });
    const res = await c.callTool({ name: "save_translation", arguments: { strings: { "core:a": "b" } } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("No batch is open");
  });
});
