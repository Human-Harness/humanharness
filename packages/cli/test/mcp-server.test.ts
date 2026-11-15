import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli";
import { main } from "../src/main";
import { configSnippet } from "../src/mcp/config-snippet";
import { findMode } from "../src/mcp/mode";
import { createServer } from "../src/mcp/server";
import { memoryIo, tempRoot } from "./helpers";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/humanharness.js");

let root: string;
let cleanup: () => void;
let home: string;
beforeEach(() => {
  ({ root, cleanup } = tempRoot("hh-mcp-"));
  home = path.join(root, "app");
  fs.mkdirSync(path.join(home, "mods", "x"), { recursive: true });
  fs.writeFileSync(path.join(home, ".layers.json"), "{}\n");
});
afterEach(() => cleanup());

describe("findMode", () => {
  it("finds the app's home by walking up, or takes --home", () => {
    expect(findMode(path.join(home, "mods", "x"), {})).toEqual({ mode: "app", home });
    expect(findMode(root, { home: "app" })).toEqual({ mode: "app", home });
  });

  it("refuses outside a home folder, and --harness for now", () => {
    expect(() => findMode(root, {})).toThrow(new CliError("Run this inside the app's home folder, or pass --home <dir> (harness projects come later)"));
    expect(() => findMode(home, { harness: "h" })).toThrow(new CliError("harness mode isn't available yet"));
  });
});

describe("createServer", () => {
  it("is named humanharness and lists the status tool to an in-process client", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createServer({ mode: "app", home });
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
    const version = (JSON.parse(fs.readFileSync(path.join(path.dirname(BIN), "..", "package.json"), "utf8")) as { version: string }).version;
    expect(client.getServerVersion()).toMatchObject({ name: "humanharness", version });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["status"]);
    const r = await client.callTool({ name: "status", arguments: {} });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("The app isn't running");
    await client.close();
  });
});

describe("mcp --config", () => {
  it("prints the claude command and the codex block with node and the absolute bin path", async () => {
    expect(configSnippet("claude")).toBe(`claude mcp add humanharness -- ${process.execPath} ${BIN} mcp\n`);
    expect(configSnippet("codex")).toBe(`[mcp_servers.humanharness]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(BIN)}, "mcp"]\n`);
    expect(configSnippet("claude", home)).toBe(`claude mcp add humanharness -- ${process.execPath} ${BIN} mcp --home ${home}\n`);
    expect(configSnippet("codex", home)).toContain(`args = [${JSON.stringify(BIN)}, "mcp", "--home", ${JSON.stringify(home)}]`);
  });

  it("shell-quotes what needs it in the claude command, as an Application Support home does", () => {
    const spaced = "/Users/x/Library/Application Support/Human Harness/app";
    const line = configSnippet("claude", spaced);
    expect(line).toContain(`--home '/Users/x/Library/Application Support/Human Harness/app'\n`);
    expect(configSnippet("claude", "/tmp/it's here")).toContain(`--home '/tmp/it'\\''s here'\n`);
    expect(configSnippet("codex", spaced)).toContain(`"--home", ${JSON.stringify(spaced)}]`);
  });

  it("is what `humanharness mcp --config` prints, with --home made absolute", async () => {
    const m = memoryIo(root);
    expect(await main(["mcp", "--config", "claude", "--home", "app"], m.io)).toBe(0);
    expect(m.out()).toBe(configSnippet("claude", home));
    const bad = memoryIo(root);
    expect(await main(["mcp", "--config", "vim"], bad.io)).toBe(2);
  });
});
