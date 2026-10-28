import { describe, expect, it } from "vitest";
import { effectiveCaps, engineHold, parallelInfo } from "../src/main/parallel-config";

describe("effectiveCaps (parallel spec §7)", () => {
  it("the person's value wins, clamped to 1..8; else the manifest's", () => {
    expect(effectiveCaps({ tasks: 3, jobs: 1 }, undefined)).toEqual({ tasks: 3, jobs: 1 });
    expect(effectiveCaps({ tasks: 3, jobs: 1 }, { tasks: 5 })).toEqual({ tasks: 5, jobs: 1 });
    expect(effectiveCaps({ tasks: 3, jobs: 1 }, { tasks: 99, jobs: 0 })).toEqual({ tasks: 8, jobs: 1 });
    expect(effectiveCaps({ tasks: 3, jobs: 2 }, { tasks: 2.5, jobs: "4" as never })).toEqual({ tasks: 3, jobs: 2 });
  });
  it("an engine not shown to run two sessions at once is held at one task (open question 6)", () => {
    expect(effectiveCaps({ tasks: 3, jobs: 2 }, undefined, { singleSession: true })).toEqual({ tasks: 1, jobs: 1 });
    expect(effectiveCaps({ tasks: 3, jobs: 2 }, { tasks: 5, jobs: 5 }, { singleSession: true })).toEqual({ tasks: 1, jobs: 1 });
  });
});

describe("engineHold (spike PT-S5)", () => {
  it("holds OpenCode at one session until a spike shows two processes work; Claude, Codex and none run free", () => {
    expect(engineHold("opencode")).toEqual({ singleSession: true });
    expect(engineHold("claude")).toEqual({});
    expect(engineHold("codex")).toEqual({});
    expect(engineHold(undefined)).toEqual({});
    // An engine no spike checked is held too (Kimi, a future ACP engine).
    expect(engineHold("kimi")).toEqual({ singleSession: true });
  });
});

describe("parallelInfo", () => {
  it("D0: undefined without parallel, whatever the config says", () => {
    expect(parallelInfo({}, {})).toBeUndefined();
    expect(parallelInfo({ inbox: false }, { parallel: { tasks: 3 }, notifyWaiting: true }, { singleSession: true })).toBeUndefined();
  });
  it("caps, suggested caps and whether the core inbox shows", () => {
    expect(parallelInfo({ parallel: { tasks: 3, jobs: 1 }, inbox: false }, { parallel: { tasks: 2 }, notifyWaiting: true })).toEqual({
      caps: { tasks: 2, jobs: 1 },
      suggested: { tasks: 3, jobs: 1 },
      inbox: false,
      notifyWaiting: true,
    });
  });
  it("defaults: the inbox shows, no notification", () => {
    expect(parallelInfo({ parallel: { tasks: 1, jobs: 1 } }, {})).toEqual({
      caps: { tasks: 1, jobs: 1 },
      suggested: { tasks: 1, jobs: 1 },
      inbox: true,
      notifyWaiting: false,
    });
  });
  it("names the engine when it holds the caps at one", () => {
    expect(parallelInfo({ parallel: { tasks: 4, jobs: 2 } }, {}, engineHold("opencode"))).toEqual({
      caps: { tasks: 1, jobs: 1 },
      suggested: { tasks: 4, jobs: 2 },
      inbox: true,
      notifyWaiting: false,
      heldReason: "engine",
    });
  });
});
