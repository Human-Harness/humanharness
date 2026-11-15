import fs from "node:fs";
import { type Server, createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/mcp/server";
import { tempRoot } from "./helpers";

const TOOLS = ["catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "status", "shot"];
// The smallest PNG: one transparent pixel.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let root: string;
let cleanup: () => void;
let home: string;
let client: Client;
let http: Server | undefined;

beforeEach(async () => {
  ({ root, cleanup } = tempRoot("hh-mcp-tools-"));
  home = path.join(root, "app");
  fs.mkdirSync(path.join(home, "core", "mods", "home", "src"), { recursive: true });
  fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
  fs.writeFileSync(path.join(home, "core", "mods", "home", "mod.json"), JSON.stringify({ id: "home", name: "Home", version: "0.1.0", apiVersion: 1, ui: "ui.js" }));
  fs.writeFileSync(path.join(home, "core", "mods", "home", "src", "ui.tsx"), `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({ id: "home", ui(ctx) {} });\n`);
  fs.mkdirSync(path.join(home, "core", "layouts"), { recursive: true });
  fs.writeFileSync(path.join(home, "core", "layouts", "main.json"), "{}");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ mode: "app", home }).connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});
afterEach(async () => {
  await client.close();
  if (http) await new Promise((r) => http?.close(r));
  http = undefined;
  cleanup();
});

const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const json = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
const text = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

describe("the kit's tools", { timeout: 120_000 }, () => {
  it("lists the seven tools, each with a description and an input schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS);
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.mod_new?.inputSchema.required).toEqual(["id", "name", "description"]);
    expect(Object.keys(byName.mod_new?.inputSchema.properties ?? {})).toEqual(["id", "name", "description", "block"]);
    expect(byName.mod_check?.inputSchema.required).toEqual(["folder"]);
    expect(byName.mod_clone?.inputSchema.required).toEqual(["id"]);
    expect(byName.layout_clone?.inputSchema.required).toEqual(["name"]);
    expect(byName.mod_new?.description).toContain("Settings › Mods");
  });

  it("catalog answers JSON text", async () => {
    const r = await call("catalog");
    expect(r.isError).toBeFalsy();
    expect(json(r)).toMatchObject({ mods: [{ id: "home", layer: "core", state: "unknown" }], layouts: [{ name: "main", layer: "core" }], types: [] });
  });

  it("mod_new then mod_check is ok", async () => {
    const made = await call("mod_new", { id: "greeter", name: "Greeter", description: "Says hello." });
    expect(made.isError).toBeFalsy();
    expect(json(made)).toMatchObject({ id: "greeter", path: path.join(home, "mods", "greeter") });
    const checked = await call("mod_check", { folder: "mods/greeter" });
    expect(checked.isError).toBeFalsy();
    expect(json(checked)).toMatchObject({ ok: true });
  });

  it("a failed check is an error the agent reads, with the checks", async () => {
    const r = await call("mod_check", { folder: "mods/nowhere" });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ ok: false });
  });

  it("mod_clone of a core mod lands in mods/; onto an existing target it is an error", async () => {
    const r = await call("mod_clone", { id: "home", as: "my-home" });
    expect(r.isError).toBeFalsy();
    expect(json(r)).toMatchObject({ id: "my-home", path: path.join(home, "mods", "my-home") });
    expect(fs.existsSync(path.join(home, "mods", "my-home", "mod.json"))).toBe(true);
    const again = await call("mod_clone", { id: "home", as: "my-home" });
    expect(again.isError).toBe(true);
    expect(text(again)).toContain("already exists");
  });

  it("layout_clone copies the core's layout into layouts/", async () => {
    const r = await call("layout_clone", { name: "main", as: "mine" });
    expect(json(r)).toMatchObject({ name: "mine", path: path.join(home, "layouts", "mine.json") });
    expect((await call("layout_clone", { name: "main", as: "mine" })).isError).toBe(true);
  });

  it("mod_new refuses a core mod's id and says to use mod_clone", async () => {
    const r = await call("mod_new", { id: "home", name: "Home", description: "" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("mod_clone");
  });

  it("status and shot without the app say to open it", async () => {
    for (const name of ["status", "shot"]) {
      const r = await call(name);
      expect(r.isError).toBe(true);
      expect(text(r)).toBe("The app isn't running: open it and try again");
    }
  });

  it("shot returns the PNG the app saved as an image, and its path", async () => {
    http = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += String(c)));
      req.on("end", () => {
        const file = (JSON.parse(body || "{}") as { path?: string }).path ?? path.join(home, "shots", "now.png");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, PNG);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ path: file }));
      });
    });
    await new Promise<void>((r) => http?.listen(0, "127.0.0.1", r));
    const { port } = http.address() as AddressInfo;
    fs.writeFileSync(path.join(home, ".control.json"), JSON.stringify({ port, token: "t".repeat(64), pid: process.pid }));

    const r = await call("shot");
    expect(r.isError).toBeFalsy();
    const file = path.join(home, "shots", "now.png");
    expect(r.content).toEqual([
      { type: "image", mimeType: "image/png", data: PNG.toString("base64") },
      { type: "text", text: file },
    ]);
    const named = await call("shot", { file: "out/a.png" });
    expect(named.content[1]).toEqual({ type: "text", text: path.join(home, "out", "a.png") });
  });
});
