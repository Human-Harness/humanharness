import fs from "node:fs";
import { type Server, createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOL_NAMES, createServer } from "../src/mcp/server";
import { tempRoot } from "./helpers";

/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let root: string;
let cleanup: () => void;
let home: string;
let client: Client;
let http: Server | undefined;

function write(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

beforeEach(async () => {
  ({ root, cleanup } = tempRoot("hh-mcp-tools-"));
  home = path.join(root, "app");
  write(home, {
    ".layers.json": "{}\n",
    "core/mods/home/mod.json": JSON.stringify({ id: "home", name: "Home", version: "0.1.0", apiVersion: 1, ui: "ui.js" }),
    "core/mods/home/src/ui.tsx": `import { defineMod } from "@humanharness/mod-sdk";\nexport default defineMod({ id: "home", ui(ctx) {} });\n`,
    "core/layouts/main.json": "{}\n",
  });
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

type Content = { type: string; text?: string; data?: string; mimeType?: string }[];
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as Content;
  return { isError: r.isError === true, content, json: () => JSON.parse(content[0]?.text ?? "null") as Record<string, unknown> };
}

describe("the mod tools", () => {
  it("lists the seven tools, each with an input schema and a description", async () => {
    const { tools } = await client.listTools();
    expect(TOOL_NAMES).toEqual(["status", "catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "shot"]);
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description?.length).toBeGreaterThan(40);
    }
    const modNew = tools.find((t) => t.name === "mod_new");
    expect(Object.keys(modNew?.inputSchema.properties ?? {})).toEqual(["id", "name", "description", "block"]);
    expect(modNew?.inputSchema.required).toEqual(["id", "name", "description"]);
    expect(tools.find((t) => t.name === "mod_new")?.description).toContain("Settings › Mods");
  });

  it("makes a mod with mod_new that mod_check passes, and lists it in catalog", { timeout: 120_000 }, async () => {
    const made = await call("mod_new", { id: "greeter", name: "Greeter", description: "Greets." });
    expect(made.isError).toBe(false);
    expect(made.json()).toEqual({ id: "greeter", path: path.join(home, "mods", "greeter"), block: "main" });
    const checked = await call("mod_check", { folder: "mods/greeter" });
    expect(checked.isError).toBe(false);
    expect(checked.json()).toMatchObject({ ok: true });
    const cat = await call("catalog");
    expect((cat.json().mods as { id: string; layer: string }[]).map((m) => [m.id, m.layer])).toEqual([
      ["home", "core"],
      ["greeter", "user"],
    ]);
  });

  it("clones a core mod into mods/, and refuses a clone onto an existing target", async () => {
    const r = await call("mod_clone", { id: "home", as: "my-home" });
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({ id: "my-home", path: path.join(home, "mods", "my-home") });
    expect(fs.existsSync(path.join(home, "mods", "my-home", "mod.json"))).toBe(true);
    const again = await call("mod_clone", { id: "home", as: "my-home" });
    expect(again.isError).toBe(true);
    expect(again.content[0]?.text).toContain("already exists");
    const layout = await call("layout_clone", { name: "main", as: "mine" });
    expect(layout.json()).toMatchObject({ name: "mine", path: path.join(home, "layouts", "mine.json") });
    expect((await call("mod_new", { id: "home", name: "H", description: "" })).content[0]?.text).toContain("mod_clone");
  });

  it("returns shot as a PNG image and its path, from the running app", async () => {
    http = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += String(c)));
      req.on("end", () => {
        const file = (JSON.parse(body || "{}") as { path?: string }).path ?? path.join(home, "shots", "default.png");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, PNG);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ path: file }));
      });
    });
    await new Promise<void>((r) => http?.listen(0, "127.0.0.1", r));
    const { port } = http.address() as AddressInfo;
    fs.writeFileSync(path.join(home, ".control.json"), JSON.stringify({ port, token: "t".repeat(64), pid: process.pid }));

    const r = await call("shot", { file: "shots/a.png" });
    expect(r.isError).toBe(false);
    expect(r.content[0]).toEqual({ type: "image", mimeType: "image/png", data: PNG.toString("base64") });
    expect(r.content[1]).toEqual({ type: "text", text: path.join(home, "shots", "a.png") });
  });

  it("says the app isn't running for status and shot without it", async () => {
    for (const name of ["status", "shot"]) {
      const r = await call(name);
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toBe("The app isn't running: open it and try again");
    }
  });
});
