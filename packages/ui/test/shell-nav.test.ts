import { describe, expect, it } from "vitest";
import { railEntries } from "../src/shell-nav";

describe("railEntries (spec §4.2)", () => {
  it("gives a plain harness Home, Tasks and Settings (D0)", () => {
    expect(railEntries({ parallel: false, jobs: false, notes: false, pluginPanels: false })).toEqual(["home", "tasks", "settings"]);
  });
  it("adds Inbox with parallel, Jobs only with declared jobs, Notes, Plugins", () => {
    expect(railEntries({ parallel: true, jobs: true, notes: true, pluginPanels: true })).toEqual(["home", "tasks", "inbox", "jobs", "notes", "plugins", "settings"]);
    expect(railEntries({ parallel: true, jobs: false, notes: false, pluginPanels: false })).toEqual(["home", "tasks", "inbox", "settings"]);
  });
});
