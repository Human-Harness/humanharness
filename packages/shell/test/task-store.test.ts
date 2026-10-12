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
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), "{broken");
    expect(await new TaskStore(folder).load()).toEqual(emptyTasks());
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
