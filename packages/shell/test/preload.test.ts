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

/** `client.jobs` (parallel spec §9.1, part 3): a thin pass-through; main checks ids and scopes (J4) and refuses without jobs (D0). */
describe("the preload's jobs namespace", () => {
  it("invokes main's jobs channels with the id and scope as given", async () => {
    electron.invoke.mockClear();
    await client.jobs.list();
    await client.jobs.run("sync");
    await client.jobs.run("sync", "physics");
    expect(electron.invoke.mock.calls).toEqual([["hh:jobsList"], ["hh:jobsRun", "sync", undefined], ["hh:jobsRun", "sync", "physics"]]);
  });

  it("passes main's answer and refusal through unchanged", async () => {
    electron.invoke.mockResolvedValueOnce(false);
    expect(await client.jobs.run("sync")).toBe(false);
    electron.invoke.mockRejectedValueOnce(new Error("No jobs"));
    await expect(client.jobs.list()).rejects.toThrow("No jobs");
  });

  it("onChange listens on hh:jobsChange and unsubscribes the same handler", () => {
    const heard: unknown[] = [];
    const off = client.jobs.onChange((s) => heard.push(s));
    const [channel, handler] = electron.on.mock.calls.at(-1)!;
    expect(channel).toBe("hh:jobsChange");
    const rows = [{ id: "sync", label: "Sync", scope: null, manual: true, running: false }];
    (handler as (e: unknown, v: unknown) => void)({}, rows);
    expect(heard).toEqual([rows]);
    off();
    expect(electron.removeListener).toHaveBeenCalledWith("hh:jobsChange", handler);
  });

  it("uses only channels main registers through handle() or sends", async () => {
    const main = await fs.readFile(path.resolve(__dirname, "../src/main/index.ts"), "utf8");
    for (const ch of ["hh:jobsList", "hh:jobsRun"]) expect(main).toContain(`handle("${ch}"`);
    // The jobs host's `changed` is the one sender, and it sends only with a jobs host (never in plain mode, D0).
    expect(main).toContain('sendToWindow("hh:jobsChange"');
    expect(main).toMatch(/function jobsChanged\(\): void \{\n  const jobs = jobsHost;\n  if \(!jobs\) return;/);
    expect(main).toContain("changed: jobsChanged,");
    // One coalesced sender (no push lost to a call landing as a read ends), and a scope change re-sends the rows.
    expect(main).toContain("const pushJobs = coalescedSender(");
    expect(main).toMatch(/async function scopesChanged\(\): Promise<void> \{[^}]*jobsChanged\(\);/);
  });
});

/** `client.scopes` linked folders (hatches spec §3.2): no path ever goes to link; main registers these only with linkedFolders. */
describe("the preload's linked-folder calls", () => {
  it("linkFolder invokes hh:scopeLinkFolder with exactly the scope and the key", async () => {
    electron.invoke.mockClear();
    await client.scopes.linkFolder("app", "repos");
    await client.scopes.linked("app");
    await client.scopes.unlinkFolder("app", "repos", "/code/app");
    await client.scopes.confirmGit("app", "repos", "/code/app", false);
    expect(electron.invoke.mock.calls).toEqual([
      ["hh:scopeLinkFolder", "app", "repos"],
      ["hh:scopeLinked", "app"],
      ["hh:scopeUnlinkFolder", "app", "repos", "/code/app"],
      ["hh:scopeConfirmGit", "app", "repos", "/code/app", false],
    ]);
  });

  it("uses only channels linked-ipc.ts registers", async () => {
    const ipc = await fs.readFile(path.resolve(__dirname, "../src/main/linked-ipc.ts"), "utf8");
    for (const ch of ["hh:scopeLinked", "hh:scopeLinkFolder", "hh:scopeUnlinkFolder", "hh:scopeConfirmGit"]) expect(ipc).toContain(`handle("${ch}"`);
  });
});
