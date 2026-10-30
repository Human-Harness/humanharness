import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeEditLine, claudeResultLine, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import type { LinkedAccess } from "../src/transport";
import { type HarnessWorkspace, createWorkspace } from "../src/workspace";
import { git, messages, treeOf } from "./helpers/git";

// The real path: the shell links folders by it (and macOS's tmpdir is a link).
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hh-wsl-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const here = path.dirname(fileURLToPath(import.meta.url));
const NOTES = path.resolve(here, "../../fake-agent/fixtures/notes-harness/harness.config.ts");

let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await ws?.close();
  ws = undefined;
});

const README = "This folder is used by the Human Harness test harness.\n";
const T = "Task: t1\nAction: implement\nScope: app";
const trailer = { task: "t1", action: "implement", scope: "app" };

/**
 * A Claude workspace on fake-claude with a linked folder `L` (plain) and `G` (with its own git) next to the work
 * folder; `linkedGitdir` is a spy that puts each linked history under `<base>/linked/<name>`.
 */
async function setup(script: ClaudeScript | ((dirs: { folder: string; L: string; G: string }) => ClaudeScript), withGitdir = true) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(base, "Work");
  const L = path.join(base, "Notes");
  const G = path.join(base, "Repo");
  fs.mkdirSync(L);
  fs.mkdirSync(path.join(G, ".git"), { recursive: true });
  fs.writeFileSync(path.join(G, ".git", "HEAD"), "ref: refs/heads/main\n");
  const linkedGitdir = vi.fn((real: string) => path.join(base, "linked", path.basename(real)));
  ws = await createWorkspace({
    harness: await loadHarness(NOTES),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(base, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, typeof script === "function" ? script({ folder, L, G }) : script) },
    ...(withGitdir ? { linkedGitdir } : {}),
  });
  return { ws, base, folder, L, G, gitdir: path.join(base, "history.git"), linkedGitdir, linkedDir: path.join(base, "linked", "Notes") };
}

const tracked = (p: string): LinkedAccess => ({ path: p, mode: "write", tracked: true });

/** Resolves once `check` holds (polls every 20 ms, up to 6 s). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  if (!check()) throw new Error("timed out");
}

describe("tracked linked folders (hatches spec §3.4)", () => {
  it("D0: a turn without linked folders opens no linked history", async () => {
    const { ws, base, folder, gitdir, linkedGitdir } = await setup({ steps: [{ write: { path: "a.md", content: "A" } }, claudeResultLine(true)] });
    const slot = await ws.openSlot({ key: "main" });
    const events: Event[] = [];
    await slot.send("write a", (e) => events.push(e), { trailer: { task: "t1", action: "intro" } }).done;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(linkedGitdir).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(base, "linked"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "a.md"), "utf8")).toBe("A");
    // runtime-d0's first turn, exactly.
    expect(await messages(gitdir)).toEqual(["Start", "Turn: write a\n\nTask: t1\nAction: intro"]);
  });

  it("D0: without linkedGitdir a tracked linked folder is never committed", async () => {
    const { ws, base, L } = await setup(({ L }) => ({ steps: [{ write: { path: path.join(L, "b.md"), content: "B" } }, claudeResultLine(true)] }), false);
    const slot = await ws.openSlot({ key: "main" });
    await slot.send("one", () => {}, { trailer, scope: { linked: [tracked(L)] } }).done;
    expect(fs.readFileSync(path.join(L, "b.md"), "utf8")).toBe("B");
    expect(fs.readdirSync(base)).not.toContain("linked");
  });

  it("a turn commits both histories with the same trailers", async () => {
    const { ws, folder, L, gitdir, linkedGitdir, linkedDir } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^one", steps: [{ write: { path: "a.md", content: "A" } }, { write: { path: path.join(L, "b.md"), content: "B" } }, claudeResultLine(true)] },
        { match: "^two", steps: [{ write: { path: "a.md", content: "A2" } }, { write: { path: path.join(L, "b.md"), content: "B2" } }, claudeResultLine(true)] },
      ],
    }));
    const slot = await ws.openSlot({ key: "main" });
    const scope = { linked: [tracked(L)] };
    const first: Event[] = [];
    await slot.send("one", (e) => first.push(e), { trailer, scope }).done;
    expect(first.at(-1)).toEqual({ type: "done", ok: true });
    // The person edits both folders between turns: the next turn snapshots each first, under its trailer.
    fs.writeFileSync(path.join(folder, "mine.md"), "M");
    fs.writeFileSync(path.join(L, "mine.md"), "N");
    await slot.send("two", () => {}, { trailer, scope }).done;

    // One history for L, its gitdir asked for by the real path once.
    expect(linkedGitdir.mock.calls).toEqual([[fs.realpathSync.native(L)]]);
    const turns = ["Start", `Turn: one\n\n${T}`, `Before message\n\n${T}`, `Turn: two\n\n${T}`];
    expect(await messages(gitdir)).toEqual(turns);
    expect(await messages(linkedDir)).toEqual(turns);
    const head = (await git.log({ fs, gitdir: linkedDir }))[0].oid;
    expect(await treeOf(linkedDir, head)).toEqual({ "b.md": "B2", "mine.md": "N" });
    const mainHead = (await git.log({ fs, gitdir }))[0].oid;
    expect(await treeOf(gitdir, mainHead)).toEqual({ "README.md": README, "a.md": "A2", "mine.md": "M" });
    // The workspace hands the open history out by the folder's real path (Task 11); a folder never opened: null.
    expect(await ws.linkedHistory(L)).not.toBeNull();
    expect(await ws.linkedHistory(folder)).toBeNull();
  });

  it("an untracked (git) linked folder is never committed", async () => {
    const { ws, base, G, linkedGitdir } = await setup(({ G }) => ({ steps: [{ write: { path: path.join(G, "c.md"), content: "C" } }, claudeResultLine(true)] }));
    const slot = await ws.openSlot({ key: "main" });
    const events: Event[] = [];
    await slot.send("one", (e) => events.push(e), { trailer, scope: { linked: [{ path: G, mode: "write", tracked: false }] } }).done;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(linkedGitdir).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(base, "linked"))).toBe(false);
    expect(fs.readFileSync(path.join(G, "c.md"), "utf8")).toBe("C");
    expect(await ws.linkedHistory(G)).toBeNull();
  });

  it("a read folder is never committed, even marked tracked", async () => {
    const { ws, L, linkedGitdir } = await setup({ steps: [claudeResultLine(true)] });
    const slot = await ws.openSlot({ key: "main" });
    await slot.send("one", () => {}, { trailer, scope: { linked: [{ path: L, mode: "read", tracked: true }] } }).done;
    expect(linkedGitdir).not.toHaveBeenCalled();
  });

  it("a crashed turn restores the linked folder too", async () => {
    const { ws, folder, L, linkedDir } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^one", steps: [{ write: { path: path.join(L, "keep.md"), content: "K" } }, claudeResultLine(true)] },
        { match: "^crash", steps: [{ write: { path: "a.md", content: "A" } }, { write: { path: path.join(L, "b.md"), content: "B" } }, { write: { path: path.join(L, "keep.md"), content: "K2" } }, { signal: "SIGKILL" }] },
      ],
    }));
    const slot = await ws.openSlot({ key: "main" });
    const scope = { linked: [tracked(L)] };
    await slot.send("one", () => {}, { trailer, scope }).done;
    const events: Event[] = [];
    await slot.send("crash", (e) => events.push(e), { trailer, scope }).done;
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    expect(fs.existsSync(path.join(L, "b.md"))).toBe(false);
    expect(fs.readFileSync(path.join(L, "keep.md"), "utf8")).toBe("K");
    expect(fs.existsSync(path.join(folder, "a.md"))).toBe(false);
    // The restore commits nothing new: the tree equals the turn's start.
    expect(await messages(linkedDir)).toEqual(["Start", `Turn: one\n\n${T}`]);
  });

  it("the linked history keeps its link checks: a restore never writes outside L", async () => {
    const { ws, base, L } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [{ match: "^crash", steps: [{ write: { path: path.join(L, "b.md"), content: "B" } }, { sleep: 3000 }, { signal: "SIGKILL" }] }],
    }));
    const outside = path.join(base, "Outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "x.md"), "OUT");
    fs.mkdirSync(path.join(L, "sub"));
    fs.writeFileSync(path.join(L, "sub", "x.md"), "IN");
    const slot = await ws.openSlot({ key: "main" });
    const turn = slot.send("crash", () => {}, { trailer, scope: { linked: [tracked(L)] } });
    // Mid-turn, L/sub becomes a link to a folder outside L: the restore must bring sub/x.md back inside L.
    await until(() => fs.existsSync(path.join(L, "b.md")));
    fs.rmSync(path.join(L, "sub"), { recursive: true });
    fs.symlinkSync(outside, path.join(L, "sub"));
    await turn.done;
    expect(fs.readFileSync(path.join(outside, "x.md"), "utf8")).toBe("OUT");
    expect(fs.readdirSync(outside)).toEqual(["x.md"]);
    expect(fs.lstatSync(path.join(L, "sub")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(L, "sub", "x.md"), "utf8")).toBe("IN");
    expect(fs.existsSync(path.join(L, "b.md"))).toBe(false);
  });

  it("a tracked folder inside another open linked history fails the turn; that history's work stays (probe E)", async () => {
    const { ws, L, linkedGitdir, linkedDir } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^parent", steps: [{ write: { path: path.join(L, "p.md"), content: "P" } }, claudeResultLine(true)] },
        { match: "^child", steps: [{ write: { path: path.join(L, "child", "y.md"), content: "Y" } }, claudeResultLine(true)] },
        { match: "^crash", steps: [{ write: { path: path.join(L, "z.md"), content: "Z" } }, { signal: "SIGKILL" }] },
      ],
    }));
    fs.mkdirSync(path.join(L, "child"));
    // Lane A (scope X) tracks L; lane B (scope Y) tracks L/child: two histories over the same files.
    const a = await ws.openSlot({ key: "t1" });
    const b = await ws.openSlot({ key: "t2" });
    await a.send("parent", () => {}, { trailer: { task: "t1" }, scope: { linked: [tracked(L)] } }).done;
    const eb: Event[] = [];
    await b.send("child", (e) => eb.push(e), { trailer: { task: "t2" }, scope: { linked: [tracked(path.join(L, "child"))] } }).done;
    expect(eb.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed", detail: "A linked folder overlaps another linked folder" } });
    // Refused before the engine ran: nothing written, no second history.
    expect(fs.existsSync(path.join(L, "child", "y.md"))).toBe(false);
    expect(linkedGitdir).toHaveBeenCalledTimes(1);
    // A's crash restores only what its own history knows.
    fs.writeFileSync(path.join(L, "child", "mine.md"), "M");
    await a.send("crash", () => {}, { trailer: { task: "t1" }, scope: { linked: [tracked(L)] } }).done;
    expect(fs.existsSync(path.join(L, "z.md"))).toBe(false);
    expect(fs.readFileSync(path.join(L, "child", "mine.md"), "utf8")).toBe("M");
    expect((await messages(linkedDir)).map((m) => m.split("\n")[0])).toEqual(["Start", "Turn: parent", "Before message"]);
  });

  it("a tracked folder that is, holds or sits inside the work folder fails the turn", async () => {
    const { ws, folder, linkedGitdir } = await setup({ steps: [claudeResultLine(true)] });
    const slot = await ws.openSlot({ key: "main" });
    for (const p of [folder, path.dirname(folder), path.join(folder, "sub")]) {
      fs.mkdirSync(p, { recursive: true });
      const events: Event[] = [];
      await slot.send("one", (e) => events.push(e), { trailer, scope: { linked: [tracked(p)] } }).done;
      expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed", detail: "A linked folder overlaps the work folder" } });
    }
    expect(linkedGitdir).not.toHaveBeenCalled();
  });

  it("a stored folder swapped for a link fails the turn; no history opens at its target (probe D)", async () => {
    const { ws, base, L, linkedGitdir } = await setup(({ L }) => ({ steps: [{ write: { path: path.join(L, "b.md"), content: "B" } }, claudeResultLine(true)] }));
    const target = path.join(base, "Target");
    fs.mkdirSync(target);
    fs.rmSync(L, { recursive: true });
    fs.symlinkSync(target, L);
    const slot = await ws.openSlot({ key: "main" });
    const events: Event[] = [];
    await slot.send("one", (e) => events.push(e), { trailer, scope: { linked: [tracked(L)] } }).done;
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed", detail: "A linked folder is no longer at its real path" } });
    expect(linkedGitdir).not.toHaveBeenCalled();
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it("a folder that can't be opened fails the turn before the engine runs", async () => {
    const { ws, base, folder } = await setup({ steps: [{ write: { path: "a.md", content: "A" } }, claudeResultLine(true)] });
    const slot = await ws.openSlot({ key: "main" });
    const events: Event[] = [];
    await slot.send("one", (e) => events.push(e), { trailer, scope: { linked: [tracked(path.join(base, "Gone"))] } }).done;
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    expect(fs.existsSync(path.join(folder, "a.md"))).toBe(false);
  });

  it("a linked folder's failed recording is only logged: the turn ends ok, the main folder commits", async () => {
    const { ws, L, gitdir } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^one", steps: [{ write: { path: path.join(L, "b.md"), content: "B" } }, claudeResultLine(true)] },
        { match: "^two", steps: [{ write: { path: "a.md", content: "A" } }, { write: { path: path.join(L, "b.md"), content: "B2" } }, claudeResultLine(true)] },
      ],
    }));
    const slot = await ws.openSlot({ key: "main" });
    const scope = { linked: [tracked(L)] };
    await slot.send("one", () => {}, { trailer, scope }).done;
    const linked = (await ws.linkedHistory(L))!;
    const save = linked.save.bind(linked);
    vi.spyOn(linked, "save").mockImplementation((m, t) => (m.startsWith("Turn:") ? Promise.reject(new Error("disk full")) : save(m, t)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: Event[] = [];
    await slot.send("two", (e) => events.push(e), { trailer, scope }).done;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(logged).toHaveBeenCalledWith("Could not record a linked folder's turn", expect.any(Error));
    expect((await messages(gitdir)).at(-1)).toBe(`Turn: two\n\n${T}`);
  });

  it("two slots in the same scope share one linked history and ledger (attribution per folder)", async () => {
    const { ws, L, linkedGitdir, linkedDir } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^one", steps: [claudeEditLine("e1", path.join(L, "a.md")), { write: { path: path.join(L, "a.md"), content: "a" } }, { sleep: 800 }, claudeResultLine(true)] },
        { match: "^two", steps: [claudeEditLine("e2", path.join(L, "b.md")), { write: { path: path.join(L, "b.md"), content: "b" } }, claudeResultLine(true)] },
      ],
    }));
    const a = await ws.openSlot({ key: "t1" });
    const b = await ws.openSlot({ key: "t2" });
    const scope = { linked: [tracked(L)] };
    const ta = a.send("one", () => {}, { trailer: { task: "t1" }, scope });
    // B starts once A has written in L, so the two windows surely overlap there.
    await until(() => fs.existsSync(path.join(L, "a.md")));
    const tb = b.send("two", () => {}, { trailer: { task: "t2" }, scope });
    await Promise.all([ta.done, tb.done]);

    expect(linkedGitdir).toHaveBeenCalledTimes(1);
    const log = (await git.log({ fs, gitdir: linkedDir })).reverse();
    expect(log.map((e) => e.commit.message.split("\n")[0]).sort()).toEqual(["Start", "Turn: one", "Turn: two"]);
    const changedBy = async (subject: string) => {
      const i = log.findIndex((e) => e.commit.message.startsWith(`${subject}\n`));
      const [parent, own] = [await treeOf(linkedDir, log[i - 1].oid), await treeOf(linkedDir, log[i].oid)];
      const paths = new Set([...Object.keys(parent), ...Object.keys(own)]);
      return { message: log[i].commit.message, changed: [...paths].filter((p) => parent[p] !== own[p]).sort() };
    };
    const one = await changedBy("Turn: one");
    const two = await changedBy("Turn: two");
    expect(one.changed).toEqual(["a.md"]);
    expect(two.changed).toEqual(["b.md"]);
    expect(one.message).toContain("Task: t1");
    expect(two.message).toContain("Task: t2");
    // No change lost: the head holds both.
    expect(await treeOf(linkedDir, log.at(-1)!.oid)).toEqual({ "a.md": "a", "b.md": "b" });
  });

  it("linkedRunningPaths: a running turn's named and changed paths in the linked folder, relative to it (undo, P2)", async () => {
    const { ws, L } = await setup(({ L }) => ({
      steps: [claudeResultLine(true)],
      turns: [{ match: "^one", steps: [claudeEditLine("e1", path.join(L, "x.md")), { write: { path: path.join(L, "y.md"), content: "y" } }, { sleep: 600 }, claudeResultLine(true)] }],
    }));
    expect(await ws.linkedRunningPaths(L)).toEqual([]);
    const slot = await ws.openSlot({ key: "lane" });
    const t = slot.send("one", () => {}, { trailer, scope: { linked: [tracked(L)] } });
    await until(() => fs.existsSync(path.join(L, "y.md")));
    const running = await ws.linkedRunningPaths(L);
    expect(running).toHaveLength(1);
    expect(running[0].task).toBe("t1");
    expect([...running[0].paths].sort()).toEqual(["x.md", "y.md"]);
    await t.done;
    expect(await ws.linkedRunningPaths(L)).toEqual([]);
  });
});
