import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NOTICE_VERSION, getEngine } from "@humanharness/engines";
import type { CommandDeps } from "@humanharness/shell/tasks";
import { SharedConfigStore } from "@humanharness/shell/tasks";
import { noticeMessage, readyEngine } from "../src/run";
import { tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-ready-");
afterAll(cleanup);

/** Command deps with no engine CLI anywhere; `calls` counts what ran. */
function noCli() {
  const cli = { calls: 0, deps: undefined as unknown as CommandDeps };
  cli.deps = {
    shell: "/bin/sh",
    home: root,
    run: async () => {
      cli.calls++;
      return { stdout: "", code: 1 };
    },
    isExecutable: async () => {
      cli.calls++;
      return false;
    },
    electronPath: process.execPath,
    resolveModule: () => {
      throw new Error("not bundled");
    },
  };
  return cli;
}

describe("readyEngine", () => {
  it("stops before touching the CLI when the app's notice wasn't accepted on this computer", async () => {
    const cli = noCli();
    await expect(readyEngine(getEngine("claude"), cli.deps, new SharedConfigStore(path.join(root, "shared-none")))).rejects.toThrow(noticeMessage("Claude"));
    expect(noticeMessage("Claude")).toContain("humanharness dev");
    expect(cli.calls).toBe(0);
  });

  it("with the notice accepted, stops with the app's message when the engine's CLI isn't there; nothing else is read", async () => {
    const shared = new SharedConfigStore(path.join(root, "shared"));
    await shared.update("claude", { notice: { version: NOTICE_VERSION, acceptedAt: new Date().toISOString() } });
    await expect(readyEngine(getEngine("claude"), noCli().deps, shared)).rejects.toThrow("I can't find Claude on this computer.");
  });
});
