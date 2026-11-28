// `humanharness run` loads the mods that are on, headless, for their `instructions()` and `agentTools()` only.
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadHarness } from "@humanharness/harness-sdk";
import { type ClaudeScript, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { initHarness } from "../src/init";
import { MANIFEST } from "../src/paths";
import { type RunOptions, runTask } from "../src/run";
import { runCoreMods, startRunMods } from "../src/run-mods";
import { CORE, memoryStream, replaceIn, tempRoot } from "./helpers";

// Not about the build: the tools build once per distinct set of tool sources, not once per test (cached-tool-build.ts).
vi.mock("../src/tool-build", async (real) => (await import("./cached-tool-build")).withCache(await real<typeof import("../src/tool-build")>()));

const { root, cleanup } = tempRoot("hh-run-mods-");
afterAll(cleanup);

/** A mod folder with a hand-written built main: `body` is what `main(ctx)` does. */
function writeMod(dir: string, id: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify({ id, name: id, version: "1.0.0", apiVersion: 1, main: "main.mjs" }));
  fs.writeFileSync(path.join(dir, "main.mjs"), `export default { id: ${JSON.stringify(id)}, main(ctx) {\n${body}\n} };\n`);
}
/** A main that adds one instructions line, and says it ran. */
const section = (id: string, line: string) =>
  `(globalThis.__hhRan ??= []).push(${JSON.stringify(id)});\nctx.on.instructions(() => [${JSON.stringify(line)}]);`;
const ran = () => (globalThis as { __hhRan?: string[] }).__hhRan ?? [];

/** The probe: a section with its config, and a tool that notes each call in its data folder. */
const PROBE = `
ctx.on.instructions((o) => ["Probe section: " + ctx.config.word + ", may edit: " + o.canEdit + "."]);
ctx.on.agentTools(() => [{
  name: "probe_ping",
  description: "Notes a ping.",
  inputSchema: { type: "object", properties: { said: { type: "string" } }, required: ["said"] },
  handle: async (args) => {
    const fs = await import("node:fs/promises");
    await fs.writeFile((await ctx.dataDir()) + "/ping.txt", args.said);
    ctx.log("pinged");
    return { ok: true };
  },
}]);
// Everything else is there and does nothing: a mod that uses it still loads.
ctx.on.turnEnd(() => { throw new Error("run calls no other hook"); });
ctx.on.taskOpen(() => { throw new Error("run calls no other hook"); });
ctx.on.close(() => { throw new Error("run calls no other hook"); });
ctx.ipc("hello", () => null);
ctx.push("hello", 1);
ctx.notify("hello");
ctx.stores.open("probe", {});
`;

const harnessDir = path.join(root, "my-harness");
beforeAll(async () => {
  await initHarness({ dir: harnessDir, core: CORE, install: false });
  replaceIn(harnessDir, "harness.config.ts", "mods: { example: {} },", 'mods: { example: {}, probe: { word: "kiwi" } },');
  writeMod(path.join(harnessDir, "mods", "probe"), "probe", PROBE);
});

const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
};
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
const script = (task: ClaudeScript["steps"]): ClaudeScript => ({
  steps: [...claudeTextLines("Done."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "One", summary: ["x"], decisions: [], files: [], open: [] }), result] },
    { match: "# Task: example", steps: [...task, ...claudeTextLines("Hello from the task."), result] },
  ],
});

/** Runs the example task to its end with the fake engine; answers the output and the written AGENTS.md. */
async function run(name: string, o: Partial<RunOptions> = {}, task: ClaudeScript["steps"] = []) {
  const folder = path.join(root, name);
  const input = new PassThrough();
  input.end("q\n");
  const out = memoryStream();
  await runTask({
    harnessDir,
    action: "example",
    engine: "claude",
    folder,
    input,
    output: out.stream,
    engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script(task)) } },
    ...o,
  });
  return { folder, output: out.text(), agents: fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8") };
}

describe("run and the mods", () => {
  it("gives the agent a declared mod's section and tool, with nothing new in the output", { timeout: 60_000 }, async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await run("with-probe", {}, [ui("probe_ping", { said: "pong" })]);
      expect(r.agents).toContain("\nProbe section: kiwi, may edit: false.");
      expect(fs.readFileSync(path.join(r.folder, ".harness", "mods", "probe", "ping.txt"), "utf8")).toBe("pong");
      expect(r.output).toContain("Hello from the task.");
      // The real core mods load too (on by default): none of them warns.
      expect(r.output).not.toContain("Warning:");
      // `log` is live, and goes to stderr: never into the run's output.
      expect(log).toHaveBeenCalledWith("[mod probe]", "pinged");
      expect(r.output).not.toContain("pinged");
    } finally {
      log.mockRestore();
    }
  });

  it("loads a core mod that is on by default, and not one that is off", { timeout: 60_000 }, async () => {
    const core = path.join(root, "core-mods");
    writeMod(path.join(core, "shipped-on"), "shipped-on", section("shipped-on", "From the mod that is on."));
    writeMod(path.join(core, "shipped-off"), "shipped-off", section("shipped-off", "From the mod that is off."));
    const r = await run("core-on-off", {
      coreMods: { "shipped-on": { dir: path.join(core, "shipped-on"), on: true }, "shipped-off": { dir: path.join(core, "shipped-off") } },
    });
    expect(r.agents).toContain("From the mod that is on.");
    expect(r.agents).not.toContain("From the mod that is off.");
    expect(ran()).toContain("shipped-on");
    expect(ran()).not.toContain("shipped-off");
    expect(r.output).not.toContain("Warning:");
  });

  it("prints one warning for a mod whose main throws, and goes on", { timeout: 60_000 }, async () => {
    const core = path.join(root, "core-broken");
    writeMod(path.join(core, "broken"), "broken", 'ctx.on.instructions(() => ["From the broken mod."]);\nthrow new Error("boom\\nin two lines");');
    const r = await run("broken", { coreMods: { broken: { dir: path.join(core, "broken"), on: true } } });
    expect(r.output.split("\n").filter((l) => l.startsWith("Warning:"))).toEqual(['Warning: the mod "broken" did not load: boom in two lines']);
    expect(r.output).toContain("Hello from the task.");
    expect(r.agents).toContain("Probe section: kiwi");
    expect(r.agents).not.toContain("From the broken mod.");
  });
});

describe("the core's mods in run", () => {
  it("come from the checkout's packages, and each one that is on loads headless", async () => {
    const warnings: string[] = [];
    const harness = await loadHarness(path.join(harnessDir, MANIFEST));
    const host = await startRunMods({ harness, folder: path.join(root, "headless"), warn: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);
    for (const id of ["context-panel", "history-view", "search", "sidekick"]) {
      expect(host.info(id)).toMatchObject({ on: true, mod: { dir: path.join(CORE, "packages", "mods", id), shipped: "core" } });
    }
  });

  it("come from the app's build where there is no package source", () => {
    const built = path.join(root, "out-core-mods");
    expect(runCoreMods(path.join(root, "no-packages"), built).search).toEqual({ on: true, dir: path.join(built, "search") });
  });
});
