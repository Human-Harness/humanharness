import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeEditLine, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import type { TurnAttribution } from "../src/turn-commit";
import { TurnLedger } from "../src/turn-ledger";
import { type HarnessWorkspace, type SlotRef, createWorkspace } from "../src/workspace";
import { git, treeOf } from "./helpers/git";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ws-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const NOTES = path.resolve(here, "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const STUDY = path.resolve(here, "../../fake-agent/fixtures/data-harness/harness.config.ts");
let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await ws?.close();
  ws = undefined;
});

async function setup(
  script: ClaudeScript,
  extra: { fixture?: string; data?: (r: unknown, slot: SlotRef) => Promise<unknown>; instructionSettings?: () => Promise<string[]> } = {},
) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(base, "Work");
  const gitdir = path.join(base, "history.git");
  ws = await createWorkspace({
    harness: await loadHarness(extra.fixture ?? NOTES),
    engine: getEngine("claude"),
    folder,
    gitdir,
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_PROMPTS: path.join(base, "prompts.jsonl") },
    ...(extra.data ? { data: extra.data } : {}),
    ...(extra.instructionSettings ? { instructionSettings: extra.instructionSettings } : {}),
  });
  return { ws, folder, gitdir };
}

/** Resolves once `check` holds (polls every 20 ms, up to 6 s). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  if (!check()) throw new Error("timed out");
}

describe("Workspace and slots (parallel spec §4)", () => {
  it("two slots run turns at once; each slot keeps one turn at a time; each commit holds only its own file", async () => {
    const script: ClaudeScript = {
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^one", steps: [claudeEditLine("e1", "a.md"), { write: { path: "a.md", content: "a" } }, { sleep: 600 }, ...claudeTextLines("A"), claudeResultLine(true)] },
        { match: "^two", steps: [claudeEditLine("e2", "b.md"), { write: { path: "b.md", content: "b" } }, ...claudeTextLines("B"), claudeResultLine(true)] },
      ],
    };
    const { ws, folder, gitdir } = await setup(script);
    const a = await ws.openSlot({ key: "t1" });
    const b = await ws.openSlot({ key: "t2" });
    await expect(ws.openSlot({ key: "t1" })).rejects.toThrow("A slot is already open for t1");
    const ea: Event[] = [];
    const eb: Event[] = [];
    const attributions: Record<string, TurnAttribution> = {};
    const ta = a.send("one", (e) => ea.push(e), { trailer: { task: "t1" }, onAttribution: (x) => (attributions.t1 = x) });
    expect(a.isBusy()).toBe(true);
    expect(() => a.send("again", () => {})).toThrow("A turn is already running");
    expect(ws.anyRunning()).toBe(true);
    // Slot B starts once A's turn has written, so the two windows surely overlap.
    await until(() => fs.existsSync(path.join(folder, "a.md")));
    const tb = b.send("two", (e) => eb.push(e), { trailer: { task: "t2" }, onAttribution: (x) => (attributions.t2 = x) });
    await Promise.all([ta.done, tb.done]);
    expect(ea.at(-1)).toEqual({ type: "done", ok: true });
    expect(eb.at(-1)).toEqual({ type: "done", ok: true });
    expect(ea.some((e) => e.type === "text")).toBe(true);
    expect(eb.some((e) => e.type === "text")).toBe(true);
    expect(ws.anyRunning()).toBe(false);
    expect(a.isBusy()).toBe(false);

    // Both turns overlapped (each got an attribution), whichever ended first: each Turn commit changes only its own
    // file against its parent, never the other turn's in-flight one (T2).
    const log = (await git.log({ fs, gitdir })).reverse();
    expect(log.map((e) => e.commit.message.split("\n")[0])).toEqual(expect.arrayContaining(["Start", "Turn: one", "Turn: two"]));
    expect(log).toHaveLength(3);
    const changedBy = async (subject: string) => {
      const i = log.findIndex((e) => e.commit.message.startsWith(`${subject}\n`));
      const [parent, own] = [await treeOf(gitdir, log[i - 1].oid), await treeOf(gitdir, log[i].oid)];
      const paths = new Set([...Object.keys(parent), ...Object.keys(own)]);
      return { message: log[i].commit.message, changed: [...paths].filter((p) => parent[p] !== own[p]).sort() };
    };
    const one = await changedBy("Turn: one");
    const two = await changedBy("Turn: two");
    expect(one.changed).toEqual(["a.md"]);
    expect(two.changed).toEqual(["b.md"]);
    expect(one.message).toContain("Task: t1");
    expect(two.message).toContain("Task: t2");
    expect(attributions.t2).toMatchObject({ owned: ["b.md"], shared: [], conflicts: [] });
    expect(attributions.t1).toMatchObject({ owned: ["a.md"], shared: [], conflicts: [] });
  });

  it("refuses a second turn of a task that already runs in another slot (one slot per task)", async () => {
    const { ws } = await setup({ steps: [{ sleep: 400 }, claudeResultLine(true)] });
    const a = await ws.openSlot({ key: "A" });
    const b = await ws.openSlot({ key: "B" });
    const t = a.send("x", () => {}, { trailer: { task: "t1" } });
    await until(() => ws.anyRunning());
    expect(() => b.send("y", () => {}, { trailer: { task: "t1" } })).toThrow("A turn of task t1 is already running");
    expect(b.isBusy()).toBe(false);
    await t.done;
    const eb: Event[] = [];
    await b.send("y", (e) => eb.push(e), { trailer: { task: "t1" } }).done;
    expect(eb.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("cancelling one slot's turn never touches the other's (T6)", async () => {
    const script: ClaudeScript = { steps: [claudeResultLine(true)], turns: [{ match: "^slow", steps: [{ sleep: 3000 }, claudeResultLine(true)] }] };
    const { ws } = await setup(script);
    const a = await ws.openSlot({ key: "A" });
    const b = await ws.openSlot({ key: "B" });
    const ea: Event[] = [];
    const eb: Event[] = [];
    const ta = a.send("slow", (e) => ea.push(e));
    const tb = b.send("quick", (e) => eb.push(e));
    await new Promise((r) => setTimeout(r, 200));
    ta.cancel();
    await Promise.all([ta.done, tb.done]);
    expect(ea.at(-1)).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(eb.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("a slot's data requests carry that slot's key, decided by its socket (Decision 9)", async () => {
    const seen: { key: string; request: unknown }[] = [];
    const { ws } = await setup(
      { steps: [{ mcp: { server: "data", tool: "data_query", args: { collection: "concepts" } } }, claudeResultLine(true)] },
      { fixture: STUDY, data: async (request, slot) => (seen.push({ key: slot.key, request }), { records: [], total: 0 }) },
    );
    const s = await ws.openSlot({ key: "t9" });
    await s.send("x", () => {}).done;
    expect(seen).toEqual([{ key: "t9", request: { op: "query", collection: "concepts" } }]);
  });

  it("two slots' data requests each carry their own slot's key (Decision 9)", async () => {
    const seen: string[] = [];
    const { ws } = await setup(
      { steps: [{ mcp: { server: "data", tool: "data_query", args: { collection: "concepts" } } }, claudeResultLine(true)] },
      { fixture: STUDY, data: async (_request, slot) => (seen.push(slot.key), { records: [], total: 0 }) },
    );
    const a = await ws.openSlot({ key: "t1" });
    const b = await ws.openSlot({ key: "t2" });
    await a.send("x", () => {}).done;
    await b.send("y", () => {}).done;
    await a.send("z", () => {}).done;
    expect(seen).toEqual(["t1", "t2", "t1"]);
  });

  it("onAttribution is not called for a turn that ran alone", async () => {
    const { ws } = await setup({ steps: [claudeEditLine("e1", "a.md"), { write: { path: "a.md", content: "a" } }, claudeResultLine(true)] });
    const a = await ws.openSlot({ key: "t1" });
    const onAttribution = vi.fn();
    const events: Event[] = [];
    await a.send("one", (e) => events.push(e), { trailer: { task: "t1" }, onAttribution }).done;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(onAttribution).not.toHaveBeenCalled();
  });

  it("a turn whose window could not open never closes the live window under its key", async () => {
    const { ws } = await setup({ steps: [claudeResultLine(true)] });
    const a = await ws.openSlot({ key: "A" });
    // The ledger already holds a live window for "A" (as when an earlier turn of that key still runs): open refuses.
    const open = TurnLedger.prototype.open;
    vi.spyOn(TurnLedger.prototype, "open").mockImplementationOnce(function (this: TurnLedger, key, task) {
      open.call(this, key, task);
      throw new Error(`A turn is already open for ${key}`);
    });
    const events: Event[] = [];
    await a.send("x", (e) => events.push(e)).done;
    expect(events.at(-1)).toMatchObject({ ok: false, error: { code: "agent-crashed", detail: "A turn is already open for A" } });
    expect(ws.anyRunning()).toBe(true);
  });

  it("refreshInstructions refuses when a turn starts while the settings are read (Decision 12)", async () => {
    let sentences = ["Answer briefly."];
    let duringRead: (() => void) | undefined;
    const { ws, folder } = await setup(
      { steps: [{ sleep: 300 }, claudeResultLine(true)] },
      {
        instructionSettings: async () => {
          duringRead?.();
          return sentences;
        },
      },
    );
    const before = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    const a = await ws.openSlot({ key: "A" });
    let turn: ReturnType<typeof a.send> | undefined;
    duringRead = () => {
      duringRead = undefined;
      turn = a.send("x", () => {});
    };
    sentences = ["Answer at length."];
    expect(await ws.refreshInstructions()).toBe(false);
    expect(turn).toBeDefined();
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(before);
    await turn!.done;
    // With no turn running, the same refresh writes.
    expect(await ws.refreshInstructions()).toBe(true);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("Answer at length.");
  });

  it("refreshInstructions refuses while any slot runs (Decision 12)", async () => {
    const { ws } = await setup({ steps: [{ sleep: 500 }, claudeResultLine(true)] });
    const a = await ws.openSlot({ key: "A" });
    const t = a.send("x", () => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.anyRunning()).toBe(true);
    expect(await ws.refreshInstructions()).toBe(false);
    await t.done;
    expect(ws.anyRunning()).toBe(false);
  });

  it("a closed slot frees its key; a closing workspace opens no slot", async () => {
    const { ws } = await setup({ steps: [claudeResultLine(true)] });
    const a = await ws.openSlot({ key: "A" });
    await a.close();
    const again = await ws.openSlot({ key: "A" });
    expect(again.key).toBe("A");
    await ws.close();
    await expect(ws.openSlot({ key: "B" })).rejects.toThrow("The workspace is closing");
  });
});
