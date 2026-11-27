import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { type LoadedHarness, loadHarness } from "@humanharness/harness-sdk";
import { type RuntimeOptions, createWorkspace } from "../src";
import { reviewAgent } from "./documents-agent";

/**
 * The agent side of a harness, as the app builds it: AGENTS.md byte for byte, the `ui` server's tool list for a task and
 * a job slot, and a review tool's round trip. The files under goldens/ were captured before the writing guide and the
 * review tools became caller-provided: they change only when the agent side is meant to change.
 */

/** The one place that knows how the app asks the runtime for its writing guide and review tools. */
const appOptions = (harness: LoadedHarness, review: (request: unknown) => Promise<unknown>): Partial<RuntimeOptions> => reviewAgent(harness, review);

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = (name: string) => path.join(here, "goldens", name);
const HARNESSES = {
  demo: path.resolve(here, "../../../harnesses/demo/harness.config.ts"),
  reviewer: path.resolve(here, "../../fake-agent/fixtures/review-harness/harness.config.ts"),
  "no-kinds": path.resolve(here, "../../fake-agent/fixtures/notes-harness/harness.config.ts"),
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-golden-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

async function open(config: string) {
  const harness = await loadHarness(config);
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(dir, "Work");
  const argsFile = path.join(dir, "args.json");
  const seen: unknown[] = [];
  const ws = await createWorkspace({
    harness,
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(dir, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: argsFile },
    ...appOptions(harness, async (request) => {
      seen.push(request);
      return { id: "c1" };
    }),
  });
  closing.push(() => ws.close());
  /** Opens a slot, runs a turn and connects to the `ui` server exactly as the engine was told to start it. */
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
  return { ws, folder, ui, seen, refresh: () => ws.refreshInstructions() };
}

describe("the agent side's goldens", () => {
  it.each(Object.entries(HARNESSES))("AGENTS.md of the %s harness, written and refreshed", async (name, config) => {
    const { folder, refresh } = await open(config);
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    await expect(agents).toMatchFileSnapshot(golden(`${name}.AGENTS.md`));
    // A refresh builds the same text, so it writes nothing.
    expect(await refresh()).toBe(false);
  });

  it.each(Object.entries(HARNESSES))("the ui server's tools of the %s harness, for a task and a job slot", async (name, config) => {
    const { ui } = await open(config);
    for (const kind of ["task", "job"] as const) {
      const { tools } = await (await ui(kind)).listTools();
      await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(golden(`${name}.ui-${kind}.json`));
    }
  });

  it("each review tool's call reaches the app and answers with its result", async () => {
    const { ui, seen } = await open(HARNESSES.reviewer);
    const client = await ui("task");
    const ask = { path: "a.md", quote: "x", heading: "scope", question: "Q?", options: [{ label: "A", text: "x" }, { label: "B", text: "y" }], blocking: true };
    const reply = { path: "a.md", id: "c1", reply: "Done.", resolve: true };
    for (const [name, args] of [
      ["ask_in_document", ask],
      // An argument the tool does not declare never reaches the app, `op` included.
      ["reply_to_comment", { ...reply, op: "ask", extra: 1 }],
      ["read_review", { path: "a.md" }],
    ] as const) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError).toBeFalsy();
      expect(res.content).toEqual([{ type: "text", text: '{"id":"c1"}' }]);
    }
    expect(seen).toEqual([{ op: "ask", ...ask }, { op: "reply", ...reply }, { op: "read", path: "a.md" }]);
    // Input the schema refuses never reaches the app.
    const long = await client.callTool({ name: "read_review", arguments: { path: "x".repeat(50_001) } });
    await expect(JSON.stringify(long, null, 2) + "\n").toMatchFileSnapshot(golden("review-too-long.json"));
    expect(seen).toHaveLength(3);
  });
});
