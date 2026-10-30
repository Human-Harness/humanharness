import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TaskStore } from "../src/main/task-store";

// The "prepared" start item (tools spec slice 3): one per pre-step result, read back like any other item.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const current = (start: unknown[]) => ({
  version: 1,
  actions: {},
  current: { id: "t1", status: "waiting", startedAt: "2026-10-29T10:00:00.000Z", turns: 1, start },
});
const roundTrip = async (raw: unknown) => {
  const folder = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(folder, ".harness"));
  fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify(raw));
  return new TaskStore(folder).load();
};

describe("prepared start items in tasks.json", () => {
  it("a prepared item is kept on read with its id, label and tokens", async () => {
    const item = { id: "prepared:today", kind: "prepared", label: "Prepared · today", tokens: 300 };
    const loaded = await roundTrip(current([item]));
    expect(loaded.current?.start).toEqual([item]);
  });

  it("a prepared item with a path keeps it only if it is a relative path (as any item)", async () => {
    const loaded = await roundTrip(
      current([
        { id: "prepared:a", kind: "prepared", label: "Prepared · a", tokens: 100, path: "notes/a.md" },
        { id: "prepared:b", kind: "prepared", label: "Prepared · b", tokens: 100, path: "../out" },
        { id: "prepared:c", kind: "prepared", label: "Prepared · c", tokens: 100, path: "/etc/passwd" },
      ]),
    );
    expect(loaded.current?.start).toEqual([{ id: "prepared:a", kind: "prepared", label: "Prepared · a", tokens: 100, path: "notes/a.md" }]);
  });

  it("D0: a file without prepared items reads as before", async () => {
    const start = [
      { id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: 1200 },
      { id: "scope-instructions", kind: "scope-instructions", label: "Scope instructions", path: "main/AGENTS.md", tokens: 200 },
      { id: "brief", kind: "brief", label: "Task brief", tokens: 300 },
      { id: "notes", kind: "notes-index", label: "Notes (1)", tokens: 400, count: 1, notes: [{ path: ".harness/notes/a.md", title: "A" }] },
      { id: "app-notes", kind: "app-notes-index", label: "App notes (0)", tokens: 50, count: 0, notes: [] },
      { id: "data:tickets", kind: "data", label: "Data · tickets (12 rows)", tokens: 800, count: 12 },
      { id: "material", kind: "material", label: "Material", path: "in/a.pdf", tokens: 900 },
      { id: "pin:main:a.md", kind: "pinned", label: "Pinned · a.md", path: "a.md", tokens: 100, scope: "main" },
      { id: "pin:main:b.md", kind: "pinned-title", label: "Pinned · b.md", path: "b.md", tokens: 10, scope: "main" },
    ];
    const raw = current(start);
    const loaded = await roundTrip(raw);
    expect(loaded.current?.start).toEqual(start);
    expect(loaded.current?.start?.some((i) => i.kind === "prepared")).toBe(false);
  });
});
