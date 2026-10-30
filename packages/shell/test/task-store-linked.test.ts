import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TaskStore } from "../src/main/task-store";

// The "linked-folders" start item (hatches H1): written by the task manager, read back like any other item.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const current = (start: unknown[]) => ({
  version: 1,
  actions: {},
  current: { id: "t1", status: "waiting", startedAt: "2026-10-30T10:00:00.000Z", turns: 1, start },
});
const roundTrip = async (raw: unknown) => {
  const folder = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(folder, ".harness"));
  fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify(raw));
  return new TaskStore(folder).load();
};

describe("linked-folders start items in tasks.json", () => {
  it("a linked-folders item survives a reload with its id, label and tokens", async () => {
    const item = { id: "linked", kind: "linked-folders", label: "Folders of this scope", tokens: 40 };
    const loaded = await roundTrip(current([{ id: "brief", kind: "brief", label: "Task brief", tokens: 300 }, item]));
    expect(loaded.current?.start).toEqual([{ id: "brief", kind: "brief", label: "Task brief", tokens: 300 }, item]);
  });

  it("an unknown kind is still dropped", async () => {
    const loaded = await roundTrip(current([{ id: "x", kind: "linked-folder", label: "X", tokens: 1 }]));
    expect(loaded.current?.start).toEqual([]);
  });
});
