// The agent side comes from the documents mod, in the app and in `humanharness run`: both give AGENTS.md and the `ui`
// server's tool lists byte for byte as the runtime's goldens have them (captured before the guide and the tools moved).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { type LoadedHarness, loadHarness, documentsConfig } from "@humanharness/harness-sdk";
import type { CoreApp } from "@humanharness/mod-sdk/core";
import { createWorkspace } from "@humanharness/runtime";
import { ModHost, resolveMods, withModAgent } from "@humanharness/shell/tasks";
import { noopServices } from "../src/mod-ctx";
import { fromSource, runCoreMods, startRunMods } from "../src/run-mods";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = (name: string) => fs.readFileSync(path.join(here, "../../runtime/test/goldens", name), "utf8");
const HARNESSES = {
  demo: path.resolve(here, "../../../harnesses/demo/harness.config.ts"),
  reviewer: path.resolve(here, "../../fake-agent/fixtures/review-harness/harness.config.ts"),
  "no-kinds": path.resolve(here, "../../fake-agent/fixtures/notes-harness/harness.config.ts"),
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-docs-goldens-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const closing: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

const documents = () => ({ documents: runCoreMods().documents });
const TASK = { id: "t1", scope: "main" };

/** How each side loads the documents mod: the app with `ctx.app`, `run` headless. */
const LOADERS: Record<string, (harness: LoadedHarness, folder: string) => Promise<ModHost>> = {
  async "the app"(harness, folder) {
    const app = {
      documents: {
        canEdit: () => harness.permissions.edit === "folder",
        kinds: () => documentsConfig(harness)?.kinds ?? {},
        folder: async () => ({ base: folder, roots: async () => [folder] }),
        openTask: async () => TASK,
      },
    } as unknown as CoreApp;
    const { mods } = await resolveMods({ declared: undefined, harnessModsDir: path.join(harness.root, "mods"), local: [], core: documents() });
    const host = new ModHost({
      config: { load: async () => undefined, saveFailed: async () => undefined },
      services: () => noopServices("no engine"),
      coreApp: () => app,
      push: () => undefined,
      notice: (text) => expect.fail(text),
      changed: () => undefined,
      coreOn: () => true,
    });
    await host.start(mods.map(fromSource));
    return host;
  },
  "humanharness run": (harness, folder) => startRunMods({ harness, folder, warn: (text) => expect.fail(text), running: async () => TASK, coreMods: documents() }),
};

async function open(side: string, config: string) {
  const harness = await loadHarness(config);
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(dir, "Work");
  const argsFile = path.join(dir, "args.json");
  const mods = await LOADERS[side](harness, folder);
  closing.push(() => mods.stop());
  const ws = await createWorkspace({
    harness,
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(dir, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: argsFile },
    ...withModAgent(harness, folder, () => mods),
  });
  closing.push(() => ws.close());
  const ui = async (kind: "task" | "job") => {
    const slot = await ws.openSlot({ key: kind, kind });
    await slot.send("hi", () => {}).done;
    const argv = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    const spec = (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: { ui: { command: string; args: string[]; env: Record<string, string> } } }).mcpServers.ui;
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
    closing.push(() => client.close());
    return client;
  };
  return { ws, folder, ui };
}

describe.each(Object.keys(LOADERS))("the documents mod's agent side in %s", (side) => {
  it.each(Object.entries(HARNESSES))("AGENTS.md of the %s harness is the golden one", async (name, config) => {
    const { ws, folder } = await open(side, config);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(golden(`${name}.AGENTS.md`));
    expect(await ws.refreshInstructions()).toBe(false);
  });

  it.each(Object.entries(HARNESSES))("the ui server's tools of the %s harness are the golden ones", async (name, config) => {
    const { ui } = await open(side, config);
    for (const kind of ["task", "job"] as const) {
      const { tools } = await (await ui(kind)).listTools();
      expect(`${JSON.stringify(tools, null, 2)}\n`).toBe(golden(`${name}.ui-${kind}.json`));
    }
  });

  it("a review tool writes in the runtime's folder, under the open task; refused input never gets there", async () => {
    const { folder, ui } = await open(side, HARNESSES.reviewer);
    fs.writeFileSync(path.join(folder, "a.md"), "# Scope\n\nSome text.\n");
    const client = await ui("task");
    const long = await client.callTool({ name: "read_review", arguments: { path: "x".repeat(50_001) } });
    expect(`${JSON.stringify(long, null, 2)}\n`).toBe(golden("review-too-long.json"));
    const asked = await client.callTool({ name: "ask_in_document", arguments: { path: "a.md", quote: "Some text.", question: "Which?", options: [{ label: "A", text: "A" }, { label: "B", text: "B" }] } });
    expect(asked.isError).toBeFalsy();
    const dir = path.join(folder, ".harness", "reviews");
    const record = fs.readdirSync(dir, { recursive: true }).map(String).find((f) => f.endsWith(".json"))!;
    expect(JSON.parse(fs.readFileSync(path.join(dir, record), "utf8"))).toMatchObject({ task: TASK.id, comments: [{ author: "agent", text: "Which?" }] });
  });
});
