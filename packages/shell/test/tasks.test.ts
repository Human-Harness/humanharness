import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { TaskManager, TurnController, createCommandDeps } from "../src/main/tasks";

describe("the shell's task barrel", () => {
  it("exposes the task logic, which loads without Electron", () => {
    expect(typeof TaskManager).toBe("function");
    expect(typeof TurnController).toBe("function");
  });

  it("builds the app's command runner for any Node binary, resolving the bundled Codex adapter from the shell", async () => {
    const deps = createCommandDeps(process.execPath);
    expect(deps.electronPath).toBe(process.execPath);
    expect(fs.existsSync(deps.resolveModule("@agentclientprotocol/codex-acp/dist/index.js"))).toBe(true);
    expect(await deps.run(process.execPath, ["-e", "process.stdout.write('ok')"])).toEqual({ stdout: "ok", code: 0 });
    expect(await deps.isExecutable(process.execPath)).toBe(true);
  });
});
