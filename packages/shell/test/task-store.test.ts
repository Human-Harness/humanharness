import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type TasksFile, TaskStore, emptyTasks, interrupted } from "../src/main/task-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "f-"));

const waiting: TasksFile = {
  version: 1,
  engine: "claude",
  current: { id: "t1", action: "turn", status: "waiting", startedAt: "2026-10-12T10:00:00.000Z", turns: 2, session: { id: "s1", started: true } },
  actions: { manifest: "done" },
};

describe("TaskStore", () => {
  it("starts empty, saves atomically and reads back", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    expect(await store.load()).toEqual(emptyTasks());
    await store.save(waiting);
    expect(await store.load()).toEqual(waiting);
    expect(fs.readdirSync(path.join(folder, ".harness"))).toEqual(["tasks.json"]);
  });

  it("keeps only what it understands", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(
      path.join(folder, ".harness", "tasks.json"),
      JSON.stringify({ version: 1, actions: { a: "done", b: "weird" }, current: { id: 1 }, engine: 5 }),
    );
    expect(await new TaskStore(folder).load()).toEqual({ version: 1, current: null, actions: { a: "done" } });
  });

  it("sets a file that is not JSON aside and starts empty", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), "{broken");
    expect(await new TaskStore(folder).load()).toEqual(emptyTasks());
    const files = fs.readdirSync(path.join(folder, ".harness"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^tasks\.json\.corrupt-\d+$/);
    expect(fs.readFileSync(path.join(folder, ".harness", files[0]), "utf8")).toBe("{broken");
  });

  it("rethrows a read error other than a missing file", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness", "tasks.json"), { recursive: true });
    await expect(new TaskStore(folder).load()).rejects.toThrow();
  });
});

describe("TaskStore: the current task, field by field", () => {
  const base = { id: "t1", status: "running", startedAt: "2026-10-12T10:00:00.000Z", turns: 1 };
  const read = async (current: Record<string, unknown>, actions: Record<string, unknown> = {}) => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify({ version: 1, current, actions }));
    return new TaskStore(folder).load();
  };

  it("drops a session whose id would read as a flag", async () => {
    expect((await read({ ...base, session: { id: "--some-flag", started: true } })).current).toEqual(base);
  });

  it("drops a session whose id has whitespace", async () => {
    expect((await read({ ...base, session: { id: "abc def", started: true } })).current).toEqual(base);
    expect((await read({ ...base, session: { id: " abc", started: true } })).current).toEqual(base);
    expect((await read({ ...base, session: { id: "abc\n", started: true } })).current).toEqual(base);
  });

  it("drops a session whose id is not a string or whose started is not a boolean", async () => {
    expect((await read({ ...base, session: { id: 5, started: true } })).current).toEqual(base);
    expect((await read({ ...base, session: { id: "abc", started: "yes" } })).current).toEqual(base);
    expect((await read({ ...base, session: "abc" })).current).toEqual(base);
  });

  it("keeps a session id in the formats the engines produce", async () => {
    for (const id of ["0199a6b2-7c1e-7d3a-9f00-1234567890ab", "fake-acp-session", "fake-acp-session-2", "s1"]) {
      expect((await read({ ...base, session: { id, started: true } })).current?.session).toEqual({ id, started: true });
    }
  });

  it("keeps action and question only as strings", async () => {
    expect((await read({ ...base, action: 3, question: ["x"] })).current).toEqual(base);
    expect((await read({ ...base, action: "turn", question: "why?" })).current).toEqual({ ...base, action: "turn", question: "why?" });
  });

  it("keeps noteSaved only as a boolean", async () => {
    expect((await read({ ...base, noteSaved: "true" })).current).toEqual(base);
    expect((await read({ ...base, noteSaved: true })).current).toEqual({ ...base, noteSaved: true });
  });

  it("keeps startedAt only as a string", async () => {
    const { startedAt: _s, ...rest } = base;
    expect((await read({ ...rest, startedAt: 12 })).current).toEqual({ ...rest, startedAt: "" });
  });

  it("drops unknown fields and a non-numeric turn count", async () => {
    expect((await read({ ...base, turns: "2", extra: { evil: true } })).current).toEqual({ ...base, turns: 0 });
  });

  it("keeps only known per-action statuses", async () => {
    expect((await read(base, { a: "done", b: "unsaved", c: "unfinished", d: "running", e: 1, f: null })).actions).toEqual({
      a: "done",
      b: "unsaved",
      c: "unfinished",
    });
  });

  it("after an engine change: no task carries over, statuses stay, the engine is forgotten", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    await store.save(waiting);
    await store.forgetEngine();
    expect(await store.load()).toEqual({ version: 1, current: null, actions: { manifest: "done", turn: "unfinished" } });
  });
});

describe("interrupted", () => {
  it("ends the open task as unfinished, but a topic already done stays done", () => {
    expect(interrupted(waiting)).toEqual({ ...waiting, current: null, actions: { manifest: "done", turn: "unfinished" } });
    const again = { ...waiting, current: { ...waiting.current!, action: "manifest" } };
    expect(interrupted(again).actions).toEqual({ manifest: "done" });
    const question = { ...waiting, current: { ...waiting.current!, action: undefined } };
    expect(interrupted(question)).toEqual({ ...waiting, current: null });
    expect(interrupted(emptyTasks())).toEqual(emptyTasks());
  });
});
