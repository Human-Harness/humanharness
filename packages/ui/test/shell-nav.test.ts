import { describe, expect, it } from "vitest";
import { railCounts, railEntries } from "../src/shell-nav";

describe("railEntries (spec §4.2)", () => {
  it("gives a plain harness Home, Tasks and Settings (D0)", () => {
    expect(railEntries({ parallel: false, jobs: false, notes: false, pluginPanels: false, history: true })).toEqual(["home", "tasks"]);
  });
  it("adds Inbox with parallel, Jobs only with declared jobs, Notes, Plugins", () => {
    expect(railEntries({ parallel: true, jobs: true, notes: true, pluginPanels: true, history: true })).toEqual(["home", "tasks", "inbox", "jobs", "notes", "plugins"]);
    expect(railEntries({ parallel: true, jobs: false, notes: false, pluginPanels: false, history: true })).toEqual(["home", "tasks", "inbox"]);
  });
});

describe("the rail's TASK group (task view one column, T5)", () => {
  const base = { parallel: false, jobs: false, notes: true, pluginPanels: false, history: true };
  it("adds the task's Notes, History and Task settings after the rest, only while a task is open", () => {
    expect(railEntries({ ...base, task: { notes: 2 } })).toEqual(["home", "tasks", "notes", "task-notes", "task-history", "task-settings"]);
    expect(railEntries({ ...base, task: null })).toEqual(["home", "tasks", "notes"]);
    expect(railEntries(base)).toEqual(["home", "tasks", "notes"]);
  });
  it("has no task History entry when no mod registered the page", () => {
    expect(railEntries({ ...base, history: false, task: { notes: 2 } })).toEqual(["home", "tasks", "notes", "task-notes", "task-settings"]);
  });
  it("task-notes carries the task's note count, the Inbox its waiting count", () => {
    expect(railCounts({ ...base, task: { notes: 3 } }, 1)).toEqual({ inbox: 1, "task-notes": 3 });
    expect(railCounts(base, 0)).toEqual({ inbox: 0 });
  });
});
