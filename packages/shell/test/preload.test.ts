import { promises as fs } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { HarnessClient } from "@humanharness/ui/client";

const electron = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  invoke: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => void (electron.exposed[key] = api) },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
}));

let client: HarnessClient;

beforeAll(async () => {
  await import("../src/preload/index");
  client = electron.exposed.hh as HarnessClient;
});

/** `client.tasks` (parallel spec §9.1): a thin pass-through to main's inbox channels, which refuse in plain mode (D0). */
describe("the preload's tasks namespace", () => {
  it("invokes main's inbox channels with the id as given (main checks it, P1)", async () => {
    await client.tasks.list();
    await client.tasks.focus("a");
    await client.tasks.focus(null);
    await client.tasks.cancelQueued("c");
    await client.tasks.resumeQueues();
    expect(electron.invoke.mock.calls).toEqual([["hh:tasksList"], ["hh:tasksFocus", "a"], ["hh:tasksFocus", null], ["hh:tasksCancelQueued", "c"], ["hh:tasksResume"]]);
  });

  it("passes main's answer and refusal through unchanged", async () => {
    electron.invoke.mockResolvedValueOnce("the queued text");
    expect(await client.tasks.cancelQueued("c")).toBe("the queued text");
    electron.invoke.mockRejectedValueOnce(new Error("No parallel tasks"));
    await expect(client.tasks.list()).rejects.toThrow("No parallel tasks");
  });

  it("onChange listens on hh:tasksChange and unsubscribes the same handler", () => {
    const heard: unknown[] = [];
    const off = client.tasks.onChange((s) => heard.push(s));
    const [channel, handler] = electron.on.mock.calls.at(-1)!;
    expect(channel).toBe("hh:tasksChange");
    const state = { tasks: [], caps: { tasks: 2, jobs: 1 } };
    (handler as (e: unknown, v: unknown) => void)({}, state);
    expect(heard).toEqual([state]);
    off();
    expect(electron.removeListener).toHaveBeenCalledWith("hh:tasksChange", handler);
  });

  it("uses only channels main registers through handle() or sends", async () => {
    const main = await fs.readFile(path.resolve(__dirname, "../src/main/index.ts"), "utf8");
    for (const ch of ["hh:tasksList", "hh:tasksFocus", "hh:tasksCancelQueued", "hh:tasksResume"]) expect(main).toContain(`handle("${ch}"`);
    const host = await fs.readFile(path.resolve(__dirname, "../src/main/board-host.ts"), "utf8");
    expect(host).toContain('d.send("hh:tasksChange"');
  });
});
