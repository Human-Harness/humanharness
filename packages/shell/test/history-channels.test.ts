import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { historyIpc } from "../src/main/history-ipc";

const root = path.resolve(__dirname, "../..");

/** The window's go-backs left the core (minimal-core step 2): they are the History mod's main, through `ctx.app.history`. */
describe("the History go-backs are not core channels", () => {
  it("historyIpc has no restore channel, and the file go-back and the rows stay", () => {
    const ipc = historyIpc({ restores: {} as never, homeHistory: () => null, linked_: () => null, linkedHistoriesOf: async () => [] });
    const names = Object.keys(ipc).sort();
    expect(names).not.toContain("hh:restore");
    expect(names).not.toContain("hh:restoreTask");
    expect(names).toEqual(["hh:fileRestore", "hh:historyTasks", "hh:homeHistory", "hh:homeUndo"]);
  });

  it("neither the protocol, the client, the preload, the registrations nor the ui name them", async () => {
    // go-back.ts and history-restore.ts keep the two handler keys inside main: they are keys of a map, not channels.
    const files = ["protocol/src/channels.ts", "protocol/src/client.ts", "shell/src/preload/index.ts", "shell/src/main/app-ipc.ts", "shell/src/main/history-ipc.ts"];
    const found: string[] = [];
    for (const f of files) if (/hh:restore(Task)?"/.test(await fs.readFile(path.join(root, f), "utf8"))) found.push(f);
    for (const f of await fs.readdir(path.join(root, "ui/src"), { recursive: true })) {
      if (/\.tsx?$/.test(f) && /HistoryPage|hh:restore(Task)?"/.test(await fs.readFile(path.join(root, "ui/src", f), "utf8"))) found.push(`ui/src/${f}`);
    }
    expect(found).toEqual([]);
  });
});
