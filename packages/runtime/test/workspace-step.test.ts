import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as blocks from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { type LoadedHarness, loadHarness, z } from "@humanharness/harness-sdk";
import { type HarnessWorkspace, createWorkspace } from "../src/workspace";

// Counts the sockets a slot opens: a step slot opens none besides its bridge.
vi.mock("@humanharness/blocks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@humanharness/blocks")>();
  return { ...real, openRpc: vi.fn(real.openRpc) };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-wsstep-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDY = path.resolve(here, "../../fake-agent/fixtures/data-harness/harness.config.ts");

let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await ws?.close();
  ws = undefined;
});

type Servers = Record<string, { command: string; args: string[]; env: Record<string, string> }>;
type Jobs = NonNullable<LoadedHarness["jobs"]>;

const RECIPE = {
  label: "Triage",
  on: { manual: true },
  steps: [
    { tool: "count-notes", as: "counts" },
    { ai: "./jobs/triage.md", input: ["counts"], output: z.object({ ids: z.array(z.string()), again: z.boolean() }), tier: "light", as: "triage" },
  ],
};
const PROMPT_JOB = { label: "Sync", prompt: "./brief.md", tier: "light", on: { manual: true }, scope: "none" };

/**
 * A Claude workspace on fake-claude with everything a slot can reach: the data harness's data server, the tools server,
 * material, the review tools, two of the harness's own MCP servers, a reference folder and every permission.
 */
async function setup(jobs: Record<string, unknown>) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const args = path.join(base, "args.json");
  const catalogue = path.join(base, "tools-catalogue.json");
  fs.writeFileSync(catalogue, "[]");
  const loaded = await loadHarness(STUDY);
  const harness: LoadedHarness = {
    ...loaded,
    permissions: { edit: "folder", exec: true, web: true },
    mcp: ["mcp/one.js", "mcp/two.js"],
    tools: { "count-notes": "./tools/count-notes.ts" },
    material: {} as LoadedHarness["material"],
    jobs: jobs as Jobs,
  };
  ws = await createWorkspace({
    harness, engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
    language: "en", command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] }), HH_FAKE_ARGS: args },
    data: async () => ({ records: [], total: 0 }),
    tools: { catalogue, request: async () => null },
    material: { request: async () => null },
    review: async () => null,
    references: [{ label: "Docs", path: "/opt/docs" }],
  });
  // HH_FAKE_ARGS keeps the last run's argv only.
  const run = () => {
    const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
    const servers = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Servers;
    return { argv, servers, disallowed: argv[argv.indexOf("--disallowedTools") + 1].split(",") };
  };
  return { ws, run };
}

describe("a step slot (tools spec §7.1, R1)", () => {
  it("its MCP list is the ui server alone, with HH_STEP=<job> and HH_JOB empty", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    const { servers } = run();
    expect(Object.keys(servers)).toEqual(["ui"]);
    expect(servers.ui.env.HH_STEP).toBe("triage");
    expect(servers.ui.env.HH_JOB).toBe("");
  });

  it("no data, material, review or tools server and no harness MCP server, even when the harness has them", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    // The task slot shows the harness has them all.
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    const t = run();
    expect(Object.keys(t.servers)).toEqual(["ui", "data", "tools", "material", "study", "study-2"]);
    expect(Object.hasOwn(t.servers.ui.env, "HH_REVIEW_RPC")).toBe(true);

    const openRpc = vi.mocked(blocks.openRpc);
    openRpc.mockClear();
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    // Not even opened: no socket for a server the slot doesn't list.
    expect(openRpc).not.toHaveBeenCalled();
    const s = run();
    expect(Object.keys(s.servers)).toEqual(["ui"]);
    expect(Object.keys(s.servers.ui.env).filter((k) => k.startsWith("HH_REVIEW"))).toEqual([]);
  });

  it("permissions are edit none, exec false, web false, whatever the harness allows", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    expect(run().disallowed).toEqual(expect.arrayContaining(["Edit", "Write", "MultiEdit", "Bash", "WebFetch", "WebSearch"]));
  });

  it("MCP only: no reading or searching the folder either, its one allowed server is ui", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    const { argv, disallowed } = run();
    expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("mcp__ui");
    expect(disallowed).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Task", "WebFetch"]));
  });

  it("a step slot ignores permissions it is given: never wider than none", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage", permissions: { edit: "folder", exec: true, web: true } })).send("x", () => {}).done;
    expect(run().disallowed).toEqual(expect.arrayContaining(["Edit", "Write", "Bash", "WebFetch"]));
  });

  it("no reference folders", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    // The task slot reads the reference folder through --settings.
    expect(run().argv.join(" ")).toContain("/opt/docs");
    await (await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).send("x", () => {}).done;
    expect(run().argv.join(" ")).not.toContain("/opt/docs");
    expect(run().argv).not.toContain("--settings");
  });

  it("no scope: a linked folder sent with a turn never reaches the engine", async () => {
    const { ws, run } = await setup({ triage: RECIPE });
    const slot = await ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" });
    await slot.send("x", () => {}, { scope: { linked: [{ path: "/Users/me/manuscript", mode: "read", tracked: false }] } }).done;
    expect(run().argv.join(" ")).not.toContain("/Users/me/manuscript");
    expect(run().argv).not.toContain("--settings");
  });

  it("task and job slots of a harness with a recipe clear HH_STEP", async () => {
    const { ws, run } = await setup({ triage: RECIPE, sync: PROMPT_JOB });
    // An outer HH_STEP can't make either one a step slot.
    vi.stubEnv("HH_STEP", "triage");
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(run().servers.ui.env.HH_STEP).toBe("");
    expect(run().servers.ui.env.HH_JOB).toBe("");
    await (await ws.openSlot({ key: "job:r1", kind: "job" })).send("y", () => {}).done;
    expect(run().servers.ui.env.HH_STEP).toBe("");
    expect(run().servers.ui.env.HH_JOB).toBe("1");
  });

  it("D0: without a recipe no slot's ui env has HH_STEP", async () => {
    const { ws, run } = await setup({ sync: PROMPT_JOB });
    await (await ws.openSlot({ key: "t1" })).send("x", () => {}).done;
    expect(Object.hasOwn(run().servers.ui.env, "HH_STEP")).toBe(false);
    expect(run().servers.ui.env.HH_JOB).toBe("");
    await (await ws.openSlot({ key: "job:r1", kind: "job" })).send("y", () => {}).done;
    expect(Object.hasOwn(run().servers.ui.env, "HH_STEP")).toBe(false);
    expect(run().servers.ui.env.HH_JOB).toBe("1");
  });

  it("kind step without job is refused", async () => {
    const { ws } = await setup({ triage: RECIPE });
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step" })).rejects.toThrow("A step slot needs its job");
  });

  it("kind step for a job without an AI step is refused", async () => {
    const { ws } = await setup({ triage: RECIPE, sync: PROMPT_JOB });
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step", job: "sync" })).rejects.toThrow('No AI step for job "sync"');
    await expect(ws.openSlot({ key: "step:r1:2", kind: "step", job: "constructor" })).rejects.toThrow('No AI step for job "constructor"');
    // Refused before anything opened: the key is free.
    await expect(ws.openSlot({ key: "step:r1:1", kind: "step", job: "triage" })).resolves.toBeDefined();
  });
});
