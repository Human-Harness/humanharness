import { describe, expect, it } from "vitest";
import { saveWithFolderChange } from "../src/main/folder-change";

function setup(busy = false) {
  const log: string[] = [];
  const deps = {
    isBusy: () => busy,
    interrupt: async () => void log.push("interrupt"),
    dropRuntime: async () => void log.push("dropRuntime"),
  };
  const save = async () => void log.push("save");
  return { log, deps, save };
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
  });

  it("ends the old folder's task, saves, then drops the runtime that works on the old folder", async () => {
    const t = setup();
    await saveWithFolderChange("/b", "/a", t.deps, t.save);
    expect(t.log).toEqual(["interrupt", "save", "dropRuntime"]);
  });

  it("treats a first folder (none before) as a change too", async () => {
    const t = setup();
    await saveWithFolderChange("/b", undefined, t.deps, t.save);
    expect(t.log).toEqual(["interrupt", "save", "dropRuntime"]);
  });
});
