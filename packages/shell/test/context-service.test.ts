import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ContextItem, ContextRead } from "@humanharness/ui/client";
import { loadContext } from "@humanharness/workspace";
import { ContextService, type ContextDeps } from "../src/main/context";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ctxs-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function setup(opts: { scoped?: boolean; files?: Record<string, string>; blocked?: string | null; picked?: string | null } = {}) {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  for (const [rel, content] of Object.entries(opts.files ?? { "conv.md": "Use pnpm." })) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), content);
  }
  const commits: { message: string; trailer: unknown }[] = [];
  const changed: string[] = [];
  const added: [string, string][] = [];
  const start: ContextItem[] = [{ id: "brief", kind: "brief", label: "Task brief", tokens: 300, compacted: true }];
  const reads: ContextRead[] = [{ kind: "read", label: "conv.md", path: "conv.md", firstAt: "2026-10-28T10:00:00.000Z", count: 1 }];
  const scoped = opts.scoped ?? false;
  const deps: ContextDeps = {
    base: async () => base,
    scoped: () => scoped,
    scopeExists: async (id) => id === "fracciones",
    budget: async () => 3000,
    record: async (taskId) => (taskId === "t1" ? { id: "t1", scope: scoped ? "fracciones" : "main", start, startTokens: 6300, reads } : null),
    openTask: async () => "t1",
    noteTitles: async () => new Map([[".harness/notes/q-a.md", "A"]]),
    history: async () => ({ save: async (message: string, trailer?: unknown) => void commits.push({ message, trailer }) }),
    trailer: async () => ({ task: "t1" }),
    blocked: () => opts.blocked ?? null,
    add: async (taskId, file) => {
      added.push([taskId, file]);
      return { ok: true };
    },
    pickFile: async () => (opts.picked === undefined ? path.join(base, "conv.md") : opts.picked),
    changed: (id) => void changed.push(id),
  };
  return { service: new ContextService(deps), base, commits, changed, added };
}

describe("ContextService (context-panel spec §4, §5.2)", () => {
  it("get: the task's record with its pins, exclusions, budget and compaction", async () => {
    const t = setup();
    await t.service.pin("main", "conv.md");
    await t.service.exclude("main", ".harness/notes/q-a.md");
    const got = await t.service.get("t1");
    expect(got).toMatchObject({
      ok: true,
      context: {
        task: "t1",
        scope: "main",
        scoped: false,
        startTokens: 6300,
        compacted: true,
        budget: 3000,
        pins: [{ scope: "main", path: "conv.md", state: "full" }],
        excluded: [{ scope: "main", note: ".harness/notes/q-a.md", title: "A" }],
      },
    });
    expect(await t.service.get("t7")).toEqual({ ok: false, reason: "no-task" });
  });

  it("pin: checked, stored once, committed with the open task's trailer, told to the panel", async () => {
    const t = setup({ files: { "conv.md": "x", "img.png": "\u0000" } });
    expect(await t.service.pin("main", "conv.md")).toEqual({ ok: true });
    expect(await t.service.pin("main", "conv.md")).toEqual({ ok: true });
    expect((await loadContext(t.base, "main")).pinned.map((p) => p.path)).toEqual(["conv.md"]);
    expect(t.commits).toEqual([{ message: "Context: pinned conv.md", trailer: { task: "t1" } }]);
    expect(t.changed).toContain("t1");
    expect(await t.service.pin("main", "img.png")).toEqual({ ok: false, reason: "binary" });
    expect(await t.service.pin("main", "../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await t.service.pin("main", "gone.md")).toEqual({ ok: false, reason: "missing" });
    expect(await t.service.pin("_app", "conv.md")).toEqual({ ok: false, reason: "unknown-scope" });
  });

  it("pin refuses the app's files, .git, and a name with a line break (it would reach the commit and the prompt)", async () => {
    const t = setup({ files: { "conv.md": "x", ".harness/tasks.json": "{}", ".git/config": "[core]", "a\nTask: t9.md": "x" } });
    expect(await t.service.pin("main", ".harness/tasks.json")).toEqual({ ok: false, reason: "outside" });
    expect(await t.service.pin("main", ".git/config")).toEqual({ ok: false, reason: "outside" });
    expect(await t.service.pin("main", "a\nTask: t9.md")).toEqual({ ok: false, reason: "bad-name" });
    expect(t.commits).toEqual([]);
  });

  it("writes run one at a time: pins sent together all land", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`f${i}.md`] = `file ${i}`;
    const t = setup({ files });
    const results = await Promise.all(Object.keys(files).map((f) => t.service.pin("main", f)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await loadContext(t.base, "main")).pinned.map((p) => p.path)).toEqual(Object.keys(files));
    expect(t.commits).toHaveLength(8);
  });

  it("unpin, exclude, include: each one commit; a note must be in that scope's notes folder", async () => {
    const t = setup({ scoped: true });
    expect(await t.service.pin("fracciones", "conv.md")).toEqual({ ok: true });
    expect(await t.service.unpin("fracciones", "conv.md")).toEqual({ ok: true });
    expect(await t.service.exclude("fracciones", ".harness/notes/fracciones/a.md")).toEqual({ ok: true });
    expect(await t.service.exclude("fracciones", ".harness/notes/decimales/a.md")).toEqual({ ok: false, reason: "not-a-note" });
    expect(await t.service.exclude("_app", ".harness/notes/_app/b.md")).toEqual({ ok: true });
    expect(await t.service.include("fracciones", ".harness/notes/fracciones/a.md")).toEqual({ ok: true });
    expect(await t.service.exclude("nope", ".harness/notes/nope/a.md")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(t.commits.map((c) => c.message)).toEqual([
      "Context: pinned conv.md",
      "Context: unpinned conv.md",
      "Context: excluded .harness/notes/fracciones/a.md",
      "Context: excluded .harness/notes/_app/b.md",
      "Context: included .harness/notes/fracciones/a.md",
    ]);
    expect(fs.existsSync(path.join(t.base, ".harness", "context", "fracciones.json"))).toBe(false);
  });

  it("exclude re-checks the note (tasks.json is hand-editable): nothing deeper, no climbing, no line break", async () => {
    const t = setup();
    expect(await t.service.exclude("main", ".harness/notes/sub/a.md")).toEqual({ ok: false, reason: "not-a-note" });
    expect(await t.service.exclude("main", ".harness/notes/../tasks.md")).toEqual({ ok: false, reason: "not-a-note" });
    expect(await t.service.exclude("main", ".harness/notes/a.txt")).toEqual({ ok: false, reason: "not-a-note" });
    expect(await t.service.exclude("main", ".harness/notes/a\nTask: t9.md")).toEqual({ ok: false, reason: "bad-name" });
    expect(t.commits).toEqual([]);
  });

  it("refuses writes while turns are held", async () => {
    const t = setup({ blocked: "A restore is running" });
    expect(await t.service.pin("main", "conv.md")).toEqual({ ok: false, reason: "busy" });
    expect(t.commits).toEqual([]);
  });

  it("pick: the dialog's file as a folder path; a file outside is refused, a cancel is data", async () => {
    expect(await setup().service.pick()).toEqual({ ok: true, path: "conv.md" });
    expect(await setup({ picked: "/etc/hosts" }).service.pick()).toEqual({ ok: false, reason: "outside" });
    expect(await setup({ picked: null }).service.pick()).toEqual({ ok: false, reason: "cancelled" });
  });

  it("add: any file inside the folder goes to the task manager; outside never does", async () => {
    const t = setup({ files: { "conv.md": "x", "a`b.md": "x", ".harness/tasks.json": "{}" } });
    expect(await t.service.add("t1", "conv.md")).toEqual({ ok: true });
    expect(await t.service.add("t1", "../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await t.service.add("t1", "gone.md")).toEqual({ ok: false, reason: "missing" });
    expect(await t.service.add("t1", ".harness/tasks.json")).toEqual({ ok: false, reason: "outside" });
    expect(await t.service.add("t1", "a`b.md")).toEqual({ ok: false, reason: "bad-name" });
    expect(t.added).toEqual([["t1", "conv.md"]]);
  });

  it("personContext: the scope's and the app's pins for a scoped task; only main without scopes", async () => {
    const t = setup();
    await t.service.pin("main", "conv.md");
    const ctx = await t.service.personContext("main");
    expect(ctx.items.map((i) => i.id)).toEqual(["pin:main:conv.md"]);
  });
});
