import { describe, expect, it } from "vitest";
import { EngineGuards } from "../src/main/engine-guards";
import { saveWithFolderChange } from "../src/main/folder-change";

function setup(busy = false, guards = new EngineGuards()) {
  const log: string[] = [];
  const blocked = () => (guards.turnBlocked() ? " (blocked)" : "");
  const deps = {
    isBusy: () => busy,
    guards,
    interrupt: async () => void log.push(`interrupt${blocked()}`),
    dropRuntime: async () => void log.push(`dropRuntime${blocked()}`),
  };
  const save = async () => void log.push(`save${blocked()}`);
  return { log, deps, save, guards };
}

describe("saveWithFolderChange", () => {
  it("just saves when the folder stays the same", async () => {
    const t = setup(true);
    await saveWithFolderChange("/a", "/a", t.deps, t.save);
    await saveWithFolderChange(undefined, "/a", t.deps, t.save);
    expect(t.log).toEqual(["save", "save"]);
  });

  it("refuses a folder change while a turn runs, saving nothing", async () => {
    const t = setup(true);
    await expect(saveWithFolderChange("/b", "/a", t.deps, t.save)).rejects.toThrow("A turn is running");
    expect(t.log).toEqual([]);
    expect(t.guards.turnBlocked()).toBeNull();
  });

  it("ends the old folder's task, saves, then drops the runtime, refusing turns all along", async () => {
    const t = setup();
    const change = saveWithFolderChange("/b", "/a", t.deps, t.save);
    // Set synchronously: a send arriving right now is refused.
    expect(t.guards.turnBlocked()).toBe("The folder is being changed");
    await change;
    expect(t.log).toEqual(["interrupt (blocked)", "save (blocked)", "dropRuntime (blocked)"]);
    expect(t.guards.turnBlocked()).toBeNull();
  });

  it("lifts the block when a step fails", async () => {
    const t = setup();
    await expect(saveWithFolderChange("/b", "/a", t.deps, async () => Promise.reject(new Error("disk")))).rejects.toThrow("disk");
    expect(t.guards.turnBlocked()).toBeNull();
  });

  it("refuses a second folder change while one runs, and one during an engine change", async () => {
    const t = setup();
    const first = saveWithFolderChange("/b", "/a", t.deps, t.save);
    await expect(saveWithFolderChange("/c", "/a", t.deps, t.save)).rejects.toThrow("The folder is already being changed");
    await first;
    let release!: () => void;
    const switching = t.guards.switchEngine({
      isBusy: () => false,
      idle: async () => {},
      save: () => new Promise<void>((r) => (release = r)),
      dropRuntime: async () => {},
      archiveChat: async () => null,
    });
    await expect(saveWithFolderChange("/c", "/b", t.deps, t.save)).rejects.toThrow("The engine is being changed");
    release();
    await switching;
  });

  it("treats a first folder (none before) as a change too", async () => {
    const t = setup();
    await saveWithFolderChange("/b", undefined, t.deps, t.save);
    expect(t.log).toEqual(["interrupt (blocked)", "save (blocked)", "dropRuntime (blocked)"]);
  });
});
