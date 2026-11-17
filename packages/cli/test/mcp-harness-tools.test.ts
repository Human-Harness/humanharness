import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_TOOLS, HARNESS_TOOLS, TOOL_NAMES, createServer } from "../src/mcp/server";
import type { Mode } from "../src/mcp/mode";
import { CORE, read, tempRoot } from "./helpers";

let root: string;
let cleanup: () => void;
let clients: Client[] = [];

beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-mcp-harness-"));
});
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
  cleanup();
});

async function connect(mode: Mode): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(mode).connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

type Content = { type: string; text?: string }[];
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as Content;
  return { isError: r.isError === true, text: content[0]?.text ?? "", json: () => JSON.parse(content[0]?.text ?? "null") as Record<string, unknown> };
}

describe("the tool list per mode", () => {
  it("names seven tools in each mode: the app's and the harness's", async () => {
    expect(APP_TOOLS).toEqual(["status", "catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "shot"]);
    expect(HARNESS_TOOLS).toEqual(["catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "harness_init", "harness_check"]);
    expect(TOOL_NAMES).toBe(APP_TOOLS);
  });

  it("registers the app's tools in app mode and the harness's in harness mode", async () => {
    const home = path.join(root, "app");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
    const app = await connect({ mode: "app", home });
    expect((await app.listTools()).tools.map((t) => t.name)).toEqual([...APP_TOOLS]);
    const harness = await connect({ mode: "harness", dir: path.join(root, "h"), core: CORE });
    const tools = (await harness.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual([...HARNESS_TOOLS]);
    for (const t of tools) expect(t.description?.length).toBeGreaterThan(40);
    expect(tools.find((t) => t.name === "harness_check")?.annotations?.readOnlyHint).toBe(true);
    for (const name of ["mod_new", "mod_clone"]) expect(tools.find((t) => t.name === name)?.description).toContain("harness.config.ts");
  });

  it("still runs the app tools in app mode", async () => {
    const home = path.join(root, "app");
    fs.mkdirSync(path.join(home, "core", "layouts"), { recursive: true });
    fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
    fs.writeFileSync(path.join(home, "core", "layouts", "main.json"), "{}\n");
    const app = await connect({ mode: "app", home });
    expect((await call(app, "catalog")).json()).toMatchObject({ mods: [], layouts: [{ name: "main", layer: "core" }] });
    expect((await call(app, "layout_clone", { name: "main", as: "mine" })).isError).toBe(false);
    expect(fs.existsSync(path.join(home, "layouts", "mine.json"))).toBe(true);
  });
});

describe("harness_init and harness_check", () => {
  it("makes a harness in an empty folder that harness_check finds clean, and the mod tools work in it", { timeout: 180_000 }, async () => {
    const dir = path.join(root, "my-harness");
    fs.mkdirSync(dir);
    const client = await connect({ mode: "harness", dir, core: CORE });
    expect((await call(client, "catalog")).json()).toMatchObject({ project: false });

    const made = await call(client, "harness_init", {});
    expect(made.isError, made.text).toBe(false);
    const init = made.json();
    expect(init).toMatchObject({ dir, id: "my-harness", installed: false });
    expect(init.files).toEqual(expect.arrayContaining(["harness.config.ts", "HARNESS.md", "mods/example/mod.json", "layouts/main.json"]));
    expect((init.files as string[]).some((f) => f.startsWith("node_modules"))).toBe(false);
    expect(String(init.next)).toContain("corepack pnpm install");
    expect(read(dir, "harness.config.ts")).toContain('id: "my-harness"');

    const checked = await call(client, "harness_check");
    expect(checked.isError, checked.text).toBe(false);
    expect(checked.json()).toMatchObject({ ok: true, errors: [] });

    const cat = (await call(client, "catalog")).json();
    expect(cat).toMatchObject({ project: true, declared: ["example"] });
    expect((cat.coreMods as { id: string }[]).map((m) => m.id)).toContain("home");
    const cloned = await call(client, "mod_clone", { id: "home", as: "start" });
    expect(cloned.json()).toMatchObject({ id: "start", path: path.join(dir, "mods", "start"), clonedFrom: { id: "home" } });
    // Not declared yet: a warning, and the manifest is the agent's to edit. (A clone of home doesn't pass mod_check
    // yet: home imports what a mod may not, which harness_check reports as an error of mods/start.)
    const after = (await call(client, "harness_check")).json();
    expect(JSON.stringify(after.warnings)).toContain("mods/start is not in harness.config.ts");
    const made2 = await call(client, "mod_new", { id: "greeter", name: "Greeter", description: "Greets." });
    expect(made2.json()).toMatchObject({ path: path.join(dir, "mods", "greeter") });
    expect((await call(client, "mod_check", { folder: "mods/greeter" })).json()).toMatchObject({ ok: true });
  });

  it("refuses a folder that isn't empty", async () => {
    const dir = path.join(root, "full");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "notes.md"), "mine\n");
    const client = await connect({ mode: "harness", dir, core: CORE });
    const r = await call(client, "harness_init", {});
    expect(r.isError).toBe(true);
    expect(r.text).toContain("is not empty");
    expect(fs.readdirSync(dir)).toEqual(["notes.md"]);
  });

  it("says harness_init makes a project when harness_check runs where there is none", async () => {
    const client = await connect({ mode: "harness", dir: path.join(root, "nothing"), core: CORE });
    const r = await call(client, "harness_check");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("harness_init");
  });
});
