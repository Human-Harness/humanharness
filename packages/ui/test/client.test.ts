import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type DataChangeView, type EngineStatus, canOpenFile, engineProblem, hearsDataChange, isTextSize, nextInPath, stepTextSize } from "../src/client";
import { FakeClient } from "./fake-client";

const ready: EngineStatus = {
  engineId: "claude",
  installed: true,
  version: "2.1.296",
  minVersion: "2.1.296",
  outdated: false,
  loggedIn: true,
  noticeAccepted: true,
  verified: true,
};

describe("engineProblem", () => {
  it("is null when the engine is ready", () => {
    expect(engineProblem(ready)).toBeNull();
    expect(engineProblem({ ...ready, loggedIn: null })).toBeNull();
  });

  it("asks for the notice first, then install, update, sign-in and the test prompt", () => {
    expect(engineProblem({ ...ready, noticeAccepted: false, installed: false })).toBe("notice");
    expect(engineProblem({ ...ready, installed: false, loggedIn: false })).toBe("not-installed");
    expect(engineProblem({ ...ready, outdated: true, loggedIn: false })).toBe("outdated");
    expect(engineProblem({ ...ready, loggedIn: false, verified: false })).toBe("logged-out");
    expect(engineProblem({ ...ready, verified: false })).toBe("untested");
  });
});

describe("@humanharness/ui/client", () => {
  it("imports no runtime code (no React)", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
    expect(src.match(/^import .*$/gm)?.every((line) => line.startsWith("import type "))).toBe(true);
  });
});

describe("nextInPath", () => {
  const path = ["manifest", "engines", "turn"];
  it("follows the path from the current action", () => {
    expect(nextInPath(path, "manifest", {})).toBe("engines");
    expect(nextInPath(path, "engines", { manifest: "done" })).toBe("turn");
  });

  it("from the end, outside the path or idle, suggests the first action not done yet", () => {
    expect(nextInPath(path, "turn", { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "other", { manifest: "done", engines: "unfinished" })).toBe("engines");
    expect(nextInPath(path, undefined, { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "turn", { manifest: "done", engines: "done" })).toBeNull();
    expect(nextInPath([], undefined, {})).toBeNull();
  });
});

describe("canOpenFile", () => {
  it("is true for text, data and images, and false for sources, pages and programs", () => {
    for (const f of ["a.md", "notes/b.JSON", "c.csv", "d.png", "e.pdf", "f.css"]) expect(canOpenFile(f)).toBe(true);
    for (const f of ["a.ts", "b.tsx", "c.js", "d.html", "e.svg", "run.command", "Makefile", "x.sh"]) expect(canOpenFile(f)).toBe(false);
  });
});

describe("text size", () => {
  it("steps one size at a time and stays put at either end", () => {
    expect(stepTextSize(undefined, "in")).toBe("large");
    expect(stepTextSize("large", "in")).toBe("larger");
    expect(stepTextSize("larger", "in")).toBe("largest");
    expect(stepTextSize("largest", "in")).toBe("largest");
    expect(stepTextSize("larger", "out")).toBe("large");
    expect(stepTextSize(undefined, "out")).toBe("normal");
  });

  it("goes back to normal from any size", () => {
    expect(stepTextSize("largest", "reset")).toBe("normal");
    expect(stepTextSize(undefined, "reset")).toBe("normal");
  });

  it("knows only its four sizes", () => {
    expect(["normal", "large", "larger", "largest"].every(isTextSize)).toBe(true);
    expect(isTextSize("huge")).toBe(false);
    expect(isTextSize(1.5)).toBe(false);
    expect(isTextSize("toString")).toBe(false);
  });
});

describe("the scopes contract", () => {
  it("lists, creates, opens and archives scopes, and tells listeners", async () => {
    const client = new FakeClient();
    const seen: (string | null)[] = [];
    const off = client.scopes.onChange((v) => seen.push(v.open));
    const s = await client.scopes.create("Fractions");
    expect(await client.scopes.open(s.id)).toBe(true);
    expect(await client.scopes.current()).toBe(s.id);
    await client.scopes.archive(s.id);
    expect(await client.scopes.current()).toBeNull();
    expect((await client.scopes.list())[0]).toMatchObject({ id: s.id, archived: true });
    off();
    expect(seen).toEqual([null, s.id, null]);
  });
});

describe("hearsDataChange (data.subscribe's filter)", () => {
  const change = (collection: string, scope: string): DataChangeView => ({ collection, scope, who: "agent", op: "put", key: 1 });

  it("hears its collection in its scope, or in any scope when the scope is null", () => {
    expect(hearsDataChange(change("cards", "algebra"), "cards", "algebra")).toBe(true);
    expect(hearsDataChange(change("cards", "algebra"), "cards", null)).toBe(true);
    expect(hearsDataChange(change("cards", "geometry"), "cards", "algebra")).toBe(false);
    expect(hearsDataChange(change("decks", "algebra"), "cards", "algebra")).toBe(false);
  });

  it("hears an app-wide collection whatever scope it was given", () => {
    expect(hearsDataChange(change("profile", "_app"), "profile", "algebra")).toBe(true);
    expect(hearsDataChange(change("profile", "_app"), "other", "algebra")).toBe(false);
  });

  it("the fake client's subscribe filters the same way", () => {
    const client = new FakeClient();
    const seen: string[] = [];
    const off = client.data.subscribe("profile", "algebra", (c) => seen.push(c.scope));
    client.emitDataChange(change("profile", "_app"));
    client.emitDataChange(change("profile", "geometry"));
    off();
    expect(seen).toEqual(["_app"]);
  });
});

describe("FakeClient settings", () => {
  it("answers values, saves, resets to the view's defaults and tells listeners", async () => {
    const client = new FakeClient();
    client.state.settings = {
      tab: "Mine",
      sections: [],
      fields: [{ name: "tone", control: "segmented", label: "Tone", default: "patient", options: [{ value: "patient", label: "Patient" }, { value: "demanding", label: "Demanding" }], agent: true }],
    };
    client.settingsState = { values: { tone: "patient" }, pending: [] };
    const heard: unknown[] = [];
    const off = client.settings.onChange((s) => heard.push(s.values.tone));
    expect(await client.settings.set("tone", "demanding")).toEqual({ ok: true, state: { values: { tone: "demanding" }, pending: [] } });
    expect(await client.settings.reset()).toEqual({ ok: true, state: { values: { tone: "patient" }, pending: [] } });
    off();
    expect(heard).toEqual(["demanding", "patient"]);
    expect(client.settingsSets).toEqual([{ field: "tone", value: "demanding" }]);
    expect(client.settingsResets).toBe(1);
  });
});

describe("client.profiles (profiles spec §5)", () => {
  it("D0: a fake client without profiles has none and refuses changes", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    expect(client.state.profiles).toBeUndefined();
    expect(await client.profiles.get()).toEqual({ active: null, list: [] });
    expect(await client.profiles.create({ name: "Sofi" })).toEqual({ ok: false, reason: "not-ready" });
  });

  it("creates and opens profiles, telling every listener", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.state = { ...client.state, profiles: { label: "student", form: { fields: [] } } };
    const seen: (string | null)[] = [];
    client.profiles.onChange((s) => seen.push(s.active));
    const made = await client.profiles.create({ name: "Sofi" });
    expect(made.ok && made.state.config.profile).toBe("sofi");
    await client.profiles.create({ name: "Tomás" });
    expect((await client.profiles.open("sofi")).ok).toBe(true);
    expect(seen).toEqual(["sofi", "tomas", "sofi"]);
    expect(await client.profiles.archive("sofi")).toEqual({ ok: false, reason: "active" });
  });
});

describe("client.tasks (parallel spec §9.1)", () => {
  const parallel = { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false };
  /** A fake of a harness that declares `parallel`: without it every call is refused, as main does. */
  function parallelClient() {
    const client = new FakeClient();
    client.state.parallel = parallel;
    return client;
  }

  it("D0: without state.parallel every call is refused, as main does", async () => {
    const client = new FakeClient();
    await expect(client.tasks.list()).rejects.toThrow("No parallel tasks");
    await expect(client.tasks.focus("a")).rejects.toThrow("No parallel tasks");
    await expect(client.tasks.cancelQueued("c")).rejects.toThrow("No parallel tasks");
    await expect(client.tasks.resumeQueues()).rejects.toThrow("No parallel tasks");
  });

  it("answers no tasks at cap 1 by default, and its methods sit beside the task view without spreading", async () => {
    const client = parallelClient();
    expect(await client.tasks.list()).toEqual({ tasks: [], caps: { tasks: 1, jobs: 1 } });
    expect(Object.keys({ ...client.tasks }).sort()).toEqual(["actions", "current", "notes"]);
  });

  it("set() answers list and reaches every onChange listener until it unsubscribes", async () => {
    const client = parallelClient();
    const heard: string[][] = [];
    const off = client.tasks.onChange((s) => heard.push(s.tasks.map((t) => t.id)));
    const summary = { id: "a", scope: "main", action: null, label: "A question", state: "waiting" as const, startedAt: "2026-10-28T10:00:00Z", tokens: 0 };
    client.tasks.set({ tasks: [summary], caps: { tasks: 2, jobs: 1 } });
    expect(await client.tasks.list()).toEqual({ tasks: [summary], caps: { tasks: 2, jobs: 1 } });
    off();
    client.tasks.set({ tasks: [], caps: { tasks: 2, jobs: 1 } });
    expect(heard).toEqual([["a"]]);
  });

  it("records focus, cancelQueued and resumeQueues as spies; cancelQueued answers null unless a test says otherwise", async () => {
    const client = parallelClient();
    await client.tasks.focus("a");
    await client.tasks.focus(null);
    expect(await client.tasks.cancelQueued("c")).toBeNull();
    await client.tasks.resumeQueues();
    expect(client.tasks.focus).toHaveBeenCalledTimes(2);
    expect(client.tasks.focus).toHaveBeenNthCalledWith(1, "a");
    expect(client.tasks.focus).toHaveBeenNthCalledWith(2, null);
    expect(client.tasks.cancelQueued).toHaveBeenCalledWith("c");
    expect(client.tasks.resumeQueues).toHaveBeenCalledTimes(1);
    client.tasks.cancelQueued.mockResolvedValueOnce("the queued text");
    expect(await client.tasks.cancelQueued("c")).toBe("the queued text");
  });

  it("each FakeClient has its own spies", async () => {
    const a = parallelClient();
    const b = parallelClient();
    await a.tasks.focus("x");
    expect(b.tasks.focus).not.toHaveBeenCalled();
  });
});

describe("client.jobs (parallel spec §9.1, part 3)", () => {
  const info = { jobs: [{ id: "sync", label: "Sync", manual: true }] };
  const row = { id: "sync", label: "Sync", scope: null, manual: true, running: false };

  it("D0: the namespace is there, and without state.jobs every call is refused, as main does", async () => {
    const client = new FakeClient();
    expect(typeof client.jobs.list).toBe("function");
    expect(typeof client.jobs.run).toBe("function");
    expect(typeof client.jobs.onChange).toBe("function");
    await expect(client.jobs.list()).rejects.toThrow("No jobs");
    await expect(client.jobs.run("sync")).rejects.toThrow("No jobs");
  });

  it("with state.jobs: list answers what set() gave, onChange hears it until it unsubscribes, run is a spy", async () => {
    const client = new FakeClient();
    client.state.jobs = info;
    expect(await client.jobs.list()).toEqual([]);
    const heard: string[][] = [];
    const off = client.jobs.onChange((rows) => heard.push(rows.map((r) => r.id)));
    client.jobs.set([row]);
    expect(await client.jobs.list()).toEqual([row]);
    off();
    client.jobs.set([]);
    expect(heard).toEqual([["sync"]]);
    expect(await client.jobs.run("sync", "physics")).toBe(true);
    expect(client.jobs.run).toHaveBeenCalledWith("sync", "physics");
  });
});

describe("FakeClient documents (document-reader spec §5)", () => {
  it("reads, refuses, watches and opens like main and the preload", async () => {
    const c = new FakeClient();
    c.docTexts["docs/a.md"] = "# A";
    expect(await c.readDocument("docs/a.md")).toEqual({ ok: true, text: "# A", mtime: c.documentMtime, size: 3 });
    expect(await c.readDocument("docs/b.md")).toEqual({ ok: false, reason: "missing" });
    expect(await c.readDocument("../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await c.documentsExist(["docs/a.md", "docs/b.md"])).toEqual([true, false]);
    let heard = 0;
    const off = c.watchDocument("docs/a.md", () => heard++);
    c.changeDocument("docs/a.md", "# A2");
    off();
    c.changeDocument("docs/a.md", "# A3");
    expect(heard).toBe(1);
    const opened: string[] = [];
    const offOpen = c.onOpenDocument((p) => opened.push(p));
    c.openDocument("docs/a.md");
    offOpen();
    c.openDocument("docs/b.md");
    expect(opened).toEqual(["docs/a.md"]);
  });
});

describe("documents and focus (review spec §5.6)", () => {
  it("the fake answers like main: a view, a summary, results as data, and change and focus listeners", async () => {
    const c = new FakeClient();
    c.docTexts["specs/a.md"] = "## Scope\n\nBy size.\n";
    const view = await c.documents.view("specs/a.md");
    expect(view).toMatchObject({ ok: true, review: null, blob: expect.stringMatching(/^[0-9a-f]{40}$/), summary: { status: "none" } });
    expect(await c.documents.view("specs/b.md")).toEqual({ ok: false, reason: "missing" });
    expect(await c.documents.review("specs/a.md")).toBeNull();
    const changed: string[] = [];
    const off = c.documents.onChange((p) => changed.push(p));
    expect(await c.documents.comment("specs/a.md", { selected: "By size.", heading: "scope", text: "No" })).toEqual({ ok: true, id: "c1" });
    expect(changed).toEqual(["specs/a.md"]);
    off();
    expect(await c.documents.review("specs/a.md")).toMatchObject({ status: "draft", unsent: 1 });
    // The approval carries the version the view showed.
    const blob = view.ok ? view.blob : "";
    expect(await c.documents.approve("specs/a.md", blob, { reason: "Fine" })).toEqual({ ok: true });
    expect(c.reviewCalls.at(-1)).toEqual({ op: "approve", args: ["specs/a.md", blob, { reason: "Fine" }] });
    const seen: unknown[] = [];
    c.focus.onChange((s) => seen.push(s));
    c.focus.set({ on: true, path: "specs/a.md" });
    expect(c.focus.current()).toEqual({ on: true, path: "specs/a.md" });
    expect(seen).toEqual([{ on: true, path: "specs/a.md" }]);
    const opened: string[] = [];
    c.documents.onFocus((p) => opened.push(p));
    c.documents.focus("specs/a.md");
    expect(opened).toEqual(["specs/a.md"]);
  });
});

describe("files (file-timeline spec §6.3)", () => {
  it("the fake answers like main and confirms through main's dialog", async () => {
    const c = new FakeClient();
    const entry = {
      kind: "task" as const,
      author: { kind: "agent" as const, label: "Spec writer", task: "t1", action: "spec" },
      label: "1 change",
      at: "2026-10-28T10:00:00.000Z",
      from: "a".repeat(40),
      to: "b".repeat(40),
      commits: [{ id: "b".repeat(40), subject: "Turn: write", at: "2026-10-28T10:00:00.000Z" }],
    };
    c.timelines["specs/a.md"] = [entry];
    expect(await c.files.timeline("specs/a.md")).toEqual({ ok: true, entries: [entry] });
    expect(await c.files.timeline("other.md")).toEqual({ ok: false, reason: "untracked" });
    c.confirmGoBack = async () => false;
    expect(await c.files.restore("specs/a.md", entry.to)).toBe("cancelled");
    c.confirmGoBack = async () => true;
    expect(await c.files.restore("specs/a.md", entry.to)).toBe("restored");
    expect(c.goBackAsks).toHaveLength(2);
    const seen: string[] = [];
    c.files.onChange("specs/a.md", () => seen.push("a"));
    c.emitFileCommit(["specs/a.md", "b.md"]);
    c.emitFileCommit(["b.md"]);
    expect(seen).toEqual(["a"]);
  });
});
