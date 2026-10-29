import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import { fakeClaudeCommand } from "@humanharness/fake-agent";
import { type LoadedHarness, loadHarness } from "@humanharness/harness-sdk";
import { type HarnessWorkspace, type WorkspaceOptions, createWorkspace } from "../src/workspace";

/** Every socket the workspace opens, with its handler and whether it was closed; `gate` may hold or fail an open. */
const opened: { handler: (r: unknown) => Promise<unknown>; closed: boolean }[] = [];
let gate: ((n: number) => Promise<void>) | undefined;

vi.mock("@humanharness/blocks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@humanharness/blocks")>();
  return {
    ...real,
    openRpc: async (handler: (r: unknown) => Promise<unknown>) => {
      await gate?.(opened.length);
      const rpc = await real.openRpc(handler);
      const entry = { handler, closed: false };
      opened.push(entry);
      return { ...rpc, close: async () => ((entry.closed = true), rpc.close()) };
    },
  };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-wstc-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDY = path.resolve(here, "../../fake-agent/fixtures/data-harness/harness.config.ts");
const TOOL = Symbol("tools request");

let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  gate = undefined;
  opened.length = 0;
  await ws?.close().catch(() => {});
  ws = undefined;
});

/** The data harness with a tool; `tools.request` answers TOOL, so its socket is the one whose handler does. */
async function setup(extra: Partial<WorkspaceOptions> = {}) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const catalogue = path.join(base, "catalogue.json");
  fs.writeFileSync(catalogue, "[]");
  const loaded = await loadHarness(STUDY);
  const harness: LoadedHarness = { ...loaded, tools: { "count-notes": "./tools/count-notes.ts" } };
  ws = await createWorkspace({
    harness, engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
    language: "en", command: fakeClaudeCommand(),
    data: async () => ({ records: [], total: 0 }),
    tools: { catalogue, request: async () => TOOL },
    ...extra,
  });
  return ws;
}

/** The tools socket: the one opened socket whose handler reaches tools.request. */
async function toolsSocket() {
  const answers = await Promise.all(opened.map((o) => o.handler({}).catch(() => null)));
  const found = opened.filter((_, i) => answers[i] === TOOL);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("a slot's tools socket closes when its open fails (tools spec §5)", () => {
  it("a later socket failing to open closes the tools socket", async () => {
    const w = await setup({ review: async () => null });
    // data (0) and tools (1) open; the review socket (2) fails.
    gate = async (n) => {
      if (n === 2) throw new Error("no socket");
    };
    await expect(w.openSlot({ key: "t1" })).rejects.toThrow("no socket");
    expect((await toolsSocket()).closed).toBe(true);
    expect(opened.every((o) => o.closed)).toBe(true);
  });

  it("the workspace closing while the slot opens closes the tools socket", async () => {
    const w = await setup();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atTools = new Promise<void>((r) => (reached = r));
    // Hold the tools socket's open (the second) until close() has started.
    gate = async (n) => {
      if (n !== 1) return;
      reached();
      await held;
    };
    const slot = w.openSlot({ key: "t1" });
    await atTools;
    const closed = w.close();
    release();
    await expect(slot).rejects.toThrow("The workspace is closing");
    await closed;
    ws = undefined;
    expect((await toolsSocket()).closed).toBe(true);
    expect(opened.every((o) => o.closed)).toBe(true);
  });
});
