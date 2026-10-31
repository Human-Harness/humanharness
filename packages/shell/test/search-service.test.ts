import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchStatus } from "@humanharness/protocol";
import { type SearchDoc, actionDocs } from "@humanharness/search";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService, type SearchServiceDeps } from "../src/main/search/service";
import { searchDir } from "../src/main/search/store";

let tmp: string;
let base: string;
let userData: string;
const put = (rel: string, text = "x", root = base) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-svc-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  fs.mkdirSync(base, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function service(o: Partial<SearchServiceDeps> = {}) {
  const statuses: SearchStatus[] = [];
  const runner = vi.fn(inProcessBuild());
  let now = Date.parse("2026-10-30T12:00:00.000Z");
  const svc = new SearchService({
    userData: () => userData,
    base: async () => base,
    scoped: () => false,
    openScope: async () => null,
    scopeTitles: async () => new Map(),
    references: async () => [],
    memory: async () => actionDocs([{ id: "topic5", label: "Topic 5", description: "Blocks and context", scope: "main" }]),
    extraDenied: async () => [],
    status: (s) => statuses.push(s),
    runner,
    reveal: vi.fn(async () => true),
    now: () => now,
    storeDelayMs: 10,
    ...o,
  });
  return { svc, statuses, runner, tick: (ms: number) => (now += ms) };
}
const ok = (a: SearchAnswer) => {
  if (!a.ok) throw new Error(`not ok: ${a.reason}`);
  return a;
};
const titles = (a: SearchAnswer) => ok(a).groups.flatMap((g) => g.hits.map((h) => h.title.map((p) => p.text).join("")));

describe("SearchService (§4, §5)", () => {
  it("D0: nothing is created until the first query; a commit before it does nothing", async () => {
    const { svc, runner } = service();
    svc.committed(["a.md"]);
    svc.committed(null);
    await svc.flush();
    expect(runner).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(userData, "search"))).toBe(false);
  });

  it("builds lazily on the first query: names, then texts, then ready", async () => {
    put("docs/guide.md", "# Guide\n\n## Context window\nthe context window holds the turn");
    put(".harness/notes/engines.md", "---\ntitle: Engines\n---\nThe context of each engine");
    const { svc, statuses } = service();
    const first = ok(await svc.query("", {}));
    expect(first.recent).toEqual([]);
    await svc.whenIdle();
    expect(statuses.map((s) => s.state)).toEqual(expect.arrayContaining(["names", "building", "ready"]));
    expect(statuses.at(-1)?.state).toBe("ready");
    const a = ok(await svc.query("context", {}));
    expect(a.groups.map((g) => g.kind)).toEqual(["task", "note", "file"]);
    expect(titles(a)).toEqual(expect.arrayContaining(["Topic 5", "Engines", "guide.md"]));
    const file = a.groups.find((g) => g.kind === "file")!.hits[0];
    expect(file.target).toEqual({ kind: "document", path: "docs/guide.md", anchor: "context-window" });
    expect(file.context.some((p) => p.mark && p.text.toLowerCase() === "context")).toBe(true);
    expect(file.hint).toEqual({ kind: "path", text: "docs/guide.md" });
    expect(a.counts.file).toBe(1);
  });

  it("a filter gives up to 50 of one kind and keeps the counts of all", async () => {
    for (let i = 0; i < 60; i++) put(`f${i}.txt`, "plan");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    const all = ok(await svc.query("plan", {}));
    expect(all.groups.find((g) => g.kind === "file")?.hits).toHaveLength(5);
    const files = ok(await svc.query("plan", { kind: "file" }));
    expect(files.groups.map((g) => g.kind)).toEqual(["file"]);
    expect(files.groups[0].hits).toHaveLength(50);
    expect(files.counts.file).toBe(60);
  });

  it("a commit's paths update the index; a restore (null) reconciles the whole folder", async () => {
    put("a.md", "alpha");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    put("b.md", "bravo");
    svc.committed(["b.md"]);
    await svc.whenIdle();
    expect(titles(await svc.query("bravo", {}))).toEqual(["b.md"]);
    fs.rmSync(path.join(base, "a.md"));
    svc.committed(null);
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual([]);
  });

  it("reconciles on open at most once per 60 s", async () => {
    const { svc, runner, tick } = service();
    await svc.query("", {});
    await svc.whenIdle();
    expect(runner).toHaveBeenCalledTimes(1);
    await svc.query("", {});
    await svc.whenIdle();
    expect(runner).toHaveBeenCalledTimes(1);
    tick(60_000);
    await svc.query("", {});
    await svc.whenIdle();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("loads a saved snapshot in a later run, and rebuilds over a corrupt one", async () => {
    put("a.md", "alpha");
    const one = service();
    await one.svc.query("", {});
    await one.svc.whenIdle();
    await one.svc.flush();
    const two = service();
    expect(titles(await two.svc.query("alpha", {}))).toEqual(["a.md"]);
    await two.svc.flush();
    const dir = path.join(userData, "search", fs.readdirSync(path.join(userData, "search"))[0]);
    fs.writeFileSync(path.join(dir, "index.json"), "{corrupt");
    const three = service();
    await three.svc.query("", {});
    await three.svc.whenIdle();
    expect(titles(await three.svc.query("alpha", {}))).toEqual(["a.md"]);
  });

  it("a build cut short after its batches were saved: on the next load, what files.json doesn't account for goes", async () => {
    put("keep.md", "alpha");
    put("gone.md", "orphanword");
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A quit or a crashed worker: the batches came in (and were saved), the "done" never did.
    const cut: SearchServiceDeps["runner"] = (job, onMessage) => {
      const r = inProcessBuild()(job, (m) => (m.type === "done" ? undefined : onMessage(m)));
      return { done: r.done.then(() => false), stop: r.stop };
    };
    const one = service({ runner: cut });
    await one.svc.query("", {});
    await one.svc.whenIdle();
    expect(titles(await one.svc.query("orphanword", {}))).toEqual(["gone.md"]);
    await one.svc.flush();
    fs.rmSync(path.join(base, "gone.md"));
    const two = service();
    await two.svc.query("", {});
    await two.svc.whenIdle();
    expect(titles(await two.svc.query("orphanword", {}))).toEqual([]);
    expect(titles(await two.svc.query("alpha", {}))).toEqual(["keep.md"]);
  });

  it("a build that fails leaves the status ready again, and each failure doubles the wait before the next reconcile", async () => {
    put("a.md", "alpha");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = false;
    const runner = vi.fn<SearchServiceDeps["runner"]>((job, onMessage) => {
      if (!fail) return inProcessBuild()(job, onMessage);
      // Like a worker that ran out of memory: some batches, then no "done".
      onMessage({ type: "docs", docs: [], done: 0, total: 1 });
      return { done: Promise.resolve(false), stop: () => {} };
    });
    const { svc, statuses, tick } = service({ runner });
    await svc.query("", {});
    await svc.whenIdle();
    fail = true;
    const calls = () => runner.mock.calls.length;
    const reopen = async (ms: number) => {
      tick(ms);
      await svc.query("", {});
      await svc.whenIdle();
    };
    await reopen(60_000);
    expect(calls()).toBe(2);
    expect(statuses.at(-1)).toEqual({ state: "ready", done: 1, total: 1 });
    expect(ok(await svc.query("", {})).status.state).toBe("ready");
    expect(error).toHaveBeenCalled();
    // One failure: 120 s.
    await reopen(60_000);
    expect(calls()).toBe(2);
    await reopen(60_000);
    expect(calls()).toBe(3);
    // Two: 240 s.
    await reopen(180_000);
    expect(calls()).toBe(3);
    await reopen(60_000);
    expect(calls()).toBe(4);
    // A build that finishes resets it.
    fail = false;
    await reopen(480_000);
    expect(calls()).toBe(5);
    await reopen(60_000);
    expect(calls()).toBe(6);
    expect(titles(await svc.query("alpha", {}))).toEqual(["a.md"]);
  });

  it("a loaded snapshot reconciles on its first search, also when the palette opens with a query", async () => {
    put("a.md", "alpha");
    const one = service();
    await one.svc.query("", {});
    await one.svc.whenIdle();
    await one.svc.flush();
    put("b.md", "alpha bravo");
    const two = service();
    expect(titles(await two.svc.query("alpha", {}))).toEqual(["a.md"]);
    await two.svc.whenIdle();
    expect(two.runner).toHaveBeenCalledTimes(1);
    expect(titles(await two.svc.query("bravo", {}))).toEqual(["b.md"]);
    await two.svc.query("alpha", {});
    await two.svc.whenIdle();
    expect(two.runner).toHaveBeenCalledTimes(1);
  });

  it("says when the file cap left files out", async () => {
    for (const p of ["a", "b", "c"]) put(p, "plan");
    const { svc } = service({ limits: { files: 2, textBytes: 1024 * 1024, totalText: 1e9 } });
    await svc.query("", {});
    await svc.whenIdle();
    expect(ok(await svc.query("plan", {})).status.truncated).toBe(true);
  });

  it("each base has its own index: nothing crosses (profiles)", async () => {
    const other = path.join(tmp, "Other");
    put("mine.md", "alpha");
    put("theirs.md", "alpha", other);
    let current = base;
    const { svc } = service({ base: async () => current });
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual(["mine.md"]);
    current = other;
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual(["theirs.md"]);
    await svc.flush();
    expect(fs.readdirSync(path.join(userData, "search"))).toHaveLength(2);
  });

  it("a base change while the first base still loads gets its own index (profiles)", async () => {
    const other = path.join(tmp, "Other");
    put("mine.md", "alpha");
    put("theirs.md", "alpha", other);
    const bases = [base, other];
    const { svc, runner } = service({ base: async () => bases.shift() ?? other });
    await Promise.all([svc.query("", {}), svc.query("", {})]);
    await svc.whenIdle();
    expect(runner.mock.calls.map(([job]) => job.roots[0].path)).toContain(other);
    expect(titles(await svc.query("alpha", {}))).toEqual(["theirs.md"]);
  });

  it("scopes: the open scope and the app by default, every scope with the toggle (remembered)", async () => {
    put(".harness/notes/physics/a.md", "---\ntitle: Physics plan\n---\nplan");
    put(".harness/notes/chem/b.md", "---\ntitle: Chem plan\n---\nplan");
    put("shared.md", "plan");
    const { svc } = service({ scoped: () => true, openScope: async () => "physics", scopeTitles: async () => new Map([["chem", "Chemistry"]]) });
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("plan", {})).sort()).toEqual(["Physics plan", "shared.md"]);
    const all = ok(await svc.query("plan", { allScopes: true }));
    expect(all.groups.flatMap((g) => g.hits).find((h) => h.scope === "Chemistry")).toBeTruthy();
    expect(ok(await svc.query("plan", {})).allScopes).toBe(true);
  });

  it("remembers what was opened: the empty query answers it first", async () => {
    put("a.md", "alpha");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    const hit = ok(await svc.query("alpha", {})).groups[0].hits[0];
    expect(await svc.opened(hit)).toEqual({ ok: true });
    expect(ok(await svc.query("", {})).recent.map((h) => h.id)).toEqual([hit.id]);
    expect(await svc.opened({ id: "nope" })).toEqual({ ok: false });
  });

  it("a reference folder's file: read only, named by its name, shown in Finder by main", async () => {
    const ref = path.join(tmp, "Ref");
    put("spec.pdf.txt", "budget", ref);
    const reveal = vi.fn(async () => true);
    const { svc } = service({ references: async () => [{ id: "docs", label: "Docs", path: ref }], reveal });
    await svc.query("", {});
    await svc.whenIdle();
    const hit = ok(await svc.query("budget", {})).groups[0].hits[0];
    expect(hit).toMatchObject({ folder: "Docs", hint: { kind: "name", text: "spec.pdf.txt" }, target: { kind: "reveal" } });
    expect(JSON.stringify(hit)).not.toContain(ref);
    expect(ok(await svc.query("budget", { references: false })).groups).toEqual([]);
    await svc.opened(hit);
    expect(reveal).toHaveBeenCalledWith(path.join(ref, "spec.pdf.txt"), [ref]);
  });

  it("not set up: not-ready, and nothing is created", async () => {
    const { svc } = service({ base: async () => null });
    expect(await svc.query("x", {})).toEqual({ ok: false, reason: "not-ready" });
    expect(fs.existsSync(path.join(userData, "search"))).toBe(false);
  });

  it("memory documents are swapped on open: a gone action leaves", async () => {
    let docs: SearchDoc[] = actionDocs([{ id: "a", label: "Alpha topic", scope: "main" }]);
    const { svc, tick } = service({ memory: async () => docs });
    await svc.query("", {});
    await svc.whenIdle();
    expect(titles(await svc.query("alpha", {}))).toEqual(["Alpha topic"]);
    docs = actionDocs([{ id: "b", label: "Beta topic", scope: "main" }]);
    tick(10_000);
    expect(titles(await svc.query("alpha", {}))).toEqual([]);
    expect(titles(await svc.query("beta", {}))).toEqual(["Beta topic"]);
  });

  it("discard drops a base's index folder", async () => {
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    await svc.flush();
    await svc.discard(base);
    expect(fs.readdirSync(path.join(userData, "search"))).toEqual([]);
  });

  it("discard drops a save still pending for the live base: the folder doesn't come back", async () => {
    put("a.md", "alpha");
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    await svc.discard(base);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(searchDir(userData, base))).toBe(false);
  });

  it("discard while the base still loads: the load settles first, and nothing brings the folder back", async () => {
    put("a.md", "alpha");
    const { svc } = service();
    const asked = svc.query("", { allScopes: true });
    // The base is known and the snapshot is being read (file reads take more than a few microtasks).
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await svc.discard(base);
    await asked;
    await svc.whenIdle();
    await svc.flush();
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(searchDir(userData, base))).toBe(false);
  });

  it("a finished build leaves no replaced documents' terms behind in the saved index", async () => {
    for (let i = 0; i < 30; i++) put(`docs/f${i}.md`, `# File ${i}\n\nwords${i} of file ${i}`);
    const { svc } = service();
    await svc.query("", {});
    await svc.whenIdle();
    await svc.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(searchDir(userData, base), "index.json"), "utf8")) as { documentCount: number; dirtCount: number };
    expect(saved.documentCount).toBeGreaterThanOrEqual(30);
    expect(saved.dirtCount).toBe(0);
    expect(titles(await svc.query("words29", {}))[0]).toBe("f29.md");
  });
});
