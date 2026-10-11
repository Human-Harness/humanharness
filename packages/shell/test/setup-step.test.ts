import { describe, expect, it, vi } from "vitest";
import type { SetupOutput } from "@humanharness/ui/client";
import { EngineGuards } from "../src/main/engine-guards";
import { requireNoticeForChoice, requireNoticeForStep, requireNoticeForTurn } from "../src/main/notice-policy";
import type { RunningSetup } from "../src/main/setup-runner";
import { type SetupStepDeps, runSetupStep } from "../src/main/setup-step";
import { EngineUnavailable } from "../src/main/turn-controller";

const accepted = (ids: string[]) => async (id: string) => ids.includes(id);

function fakeRun(code: number | null, timedOut = false): RunningSetup {
  return { write: () => {}, cancel: () => {}, kill: () => {}, timedOut: () => timedOut, exit: Promise.resolve(code) };
}

function deps(over: Partial<SetupStepDeps<string>> = {}) {
  const calls: string[] = [];
  const out: SetupOutput[] = [];
  const guards = new EngineGuards();
  const d: SetupStepDeps<string> = {
    guards,
    hasNotice: accepted(["claude"]),
    currentEngine: async () => "claude",
    isBusy: () => false,
    quitting: () => false,
    command: async () => "cmd",
    dropRuntime: async () => void calls.push("drop"),
    spawn: (cmd) => {
      calls.push(`spawn ${cmd}`);
      return fakeRun(0);
    },
    output: (o) => out.push(o),
    ...over,
  };
  return { d, calls, out, guards };
}

describe("notice policy", () => {
  it("refuses a turn on an engine whose notice isn't accepted", async () => {
    await expect(requireNoticeForTurn("codex", accepted(["claude"]))).rejects.toEqual(new EngineUnavailable("notice-required"));
    await expect(requireNoticeForTurn("codex", accepted(["claude"]))).rejects.toMatchObject({ code: "notice-required" });
    await expect(requireNoticeForTurn("claude", accepted(["claude"]))).resolves.toBeUndefined();
  });

  it("refuses every setup step but signing out without the notice", async () => {
    for (const step of ["install", "update", "login"] as const) {
      await expect(requireNoticeForStep("codex", step, accepted([]))).rejects.toThrow(/notice/);
    }
    await expect(requireNoticeForStep("codex", "logout", accepted([]))).resolves.toBeUndefined();
  });

  it("refuses choosing a new engine without its notice; saving the same engine is fine", async () => {
    await expect(requireNoticeForChoice("codex", "claude", accepted(["claude"]))).rejects.toThrow(/notice/);
    await expect(requireNoticeForChoice("codex", "claude", accepted(["codex"]))).resolves.toBeUndefined();
    await expect(requireNoticeForChoice("claude", "claude", accepted([]))).resolves.toBeUndefined();
    await expect(requireNoticeForChoice(undefined, "claude", accepted([]))).resolves.toBeUndefined();
  });
});

describe("runSetupStep", () => {
  it("runs the step and reports its start and end", async () => {
    const { d, calls, out, guards } = deps();
    expect(await runSetupStep(d, "claude", "install")).toEqual({ ok: true });
    expect(calls).toEqual(["spawn cmd"]);
    expect(out).toEqual([
      { kind: "start", engineId: "claude", step: "install" },
      { kind: "end", engineId: "claude", step: "install", ok: true },
    ]);
    expect(guards.setup).toBeNull();
  });

  it("refuses install, update and sign-in before the notice, and starts nothing", async () => {
    const { d, calls, out, guards } = deps({ hasNotice: accepted([]) });
    await expect(runSetupStep(d, "claude", "install")).rejects.toThrow(/notice/);
    expect(calls).toEqual([]);
    expect(out).toEqual([]);
    expect(guards.setup).toBeNull();
    expect(await runSetupStep(d, "claude", "logout")).toEqual({ ok: true });
  });

  it("a cancel while the CLI is being found starts nothing and keeps the engine in use", async () => {
    let found!: (cmd: string) => void;
    const { d, calls, out, guards } = deps({ command: () => new Promise((r) => (found = r)) });
    const running = runSetupStep(d, "claude", "update");
    await vi.waitFor(() => expect(guards.setup).not.toBeNull());
    expect(guards.cancelSetup()).toBe(true);
    found("cmd");
    expect(await running).toEqual({ ok: false, cancelled: true });
    expect(calls).toEqual([]);
    expect(out.at(-1)).toEqual({ kind: "end", engineId: "claude", step: "update", ok: false, cancelled: true });
    expect(guards.setup).toBeNull();
    expect(guards.setupCancelled()).toBe(false);
  });

  it("closes the engine in use before updating it, then reports a timeout", async () => {
    const { d, calls } = deps({
      spawn: (cmd) => {
        calls.push(`spawn ${cmd}`);
        return fakeRun(null, true);
      },
    });
    expect(await runSetupStep(d, "claude", "update")).toEqual({ ok: false, timedOut: true });
    expect(calls).toEqual(["drop", "spawn cmd"]);
  });

  it("refuses to start while the app quits", async () => {
    const { d, calls } = deps({ quitting: () => true });
    await expect(runSetupStep(d, "claude", "install")).rejects.toThrow(/closing/);
    expect(calls).toEqual([]);
  });
});
