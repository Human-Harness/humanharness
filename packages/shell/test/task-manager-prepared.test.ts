import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { SavedNote, Tier } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { ScopeRequired, TaskManager } from "../src/main/task-manager";
import { QUESTION_PROMPT, fillPrompt } from "../src/main/task-prompts";
import { TaskStore, type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };
const NOTE: SavedNote = { title: "Event", summary: ["An event."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const profileOf = (tier: Tier): ModelProfile => ({ engine: "claude", tier, model: "sonnet", effort: "medium", cap: 200_000 });
const PROMPT = "Explain this event from 1913 for someone curious: Sample event.";
const PREPARED = { prompt: PROMPT, display: "On this day · Explain this event", tier: "light" as const, plugin: "on-this-day" };

/** A task manager over memory, with or without scopes, recording every `profileFor` call's arguments and every trailer. */
function setup(opts: { scoped?: boolean; state?: TasksFile; script?: Event[][]; gate?: Promise<void> } = {}) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const trailers: unknown[] = [];
  const profileCalls: unknown[][] = [];
  let busy = false;
  let gate = opts.gate;
  let n = 0;
  const manager = new TaskManager({
    store: { load: async () => structuredClone(state), save: async (s) => void (state = structuredClone(s)) },
    turns: {
      isBusy: () => busy,
      cancel: () => {},
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        const g = gate;
        gate = undefined;
        await g;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { study: { label: "Study" }, onboarding: { label: "Welcome", scope: "none" } },
    path: ["study"],
    ...(opts.scoped ? { scoped: true, scopeExists: async (id: string) => id === "fracciones" } : {}),
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async () => {},
    endSession: async () => {},
    saveHistory: async (_message, trailer) => void trailers.push(trailer),
    changed: () => {},
    profileFor: async (...args: [string | undefined, Tier?, Tier?]) => {
      profileCalls.push(args);
      return profileOf(args[2] ?? args[1] ?? "standard");
    },
    now: () => new Date("2026-10-28T10:00:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, trailers, profileCalls, state: () => state };
}

describe("TaskManager.startPrepared (plugins spec §5.3)", () => {
  it("starts a free question with the prompt, shows `display`, runs at the action's tier and carries the plugin", async () => {
    const t = setup();
    await t.manager.startPrepared(PREPARED);
    const asked = setup();
    await asked.manager.ask(PROMPT);
    expect(t.turns[0].message).toBe(asked.turns[0].message);
    expect(t.turns[0].message).toBe(fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: "", question: PROMPT }));
    expect(t.turns[0].options.display).toBe(PREPARED.display);
    expect(t.profileCalls).toEqual([[undefined, undefined, "light"]]);
    expect(t.state().current).toMatchObject({ id: "t1", question: PROMPT, plugin: "on-this-day", status: "waiting", profile: { tier: "light" } });
    expect(await t.manager.trailerNow()).toEqual({ task: "t1", plugin: "on-this-day" });
    // The turn's own commits (Before message, Turn) carry it too.
    expect(t.turns[0].options.plugin).toBe("on-this-day");
  });

  it("keeps the plugin through a follow-up and on every commit of the task", async () => {
    const t = setup({ script: [[ok], [ok], [saveNote, ok]] });
    await t.manager.startPrepared(PREPARED);
    await t.manager.ask("And then?");
    expect(t.turns[1].options.followUp).toBe(true);
    expect(t.turns[1].options.plugin).toBe("on-this-day");
    expect(t.state().current?.plugin).toBe("on-this-day");
    expect(await t.manager.trailerNow()).toEqual({ task: "t1", plugin: "on-this-day" });
    await t.manager.start("study");
    expect(t.trailers).toEqual([{ task: "t1", plugin: "on-this-day" }]);
    // The next task is not the plugin's.
    expect(t.state().current).not.toHaveProperty("plugin");
    expect(await t.manager.trailerNow()).toEqual({ task: "t2", action: "study" });
  });

  it("closes a waiting task first, as `start` does: its closing turn writes the note", async () => {
    const state: TasksFile = { ...emptyTasks(), current: { id: "t0", action: "study", status: "waiting", startedAt: "", turns: 1 } };
    const t = setup({ state, script: [[saveNote, ok]] });
    await t.manager.startPrepared(PREPARED);
    expect(t.turns.map((x) => x.options.phase)).toEqual(["close", "run"]);
    expect(t.trailers).toEqual([{ task: "t0", action: "study" }]);
    expect(t.state().actions.study).toBe("done");
    expect(t.state().current).toMatchObject({ id: "t1", plugin: "on-this-day" });
  });

  it("ends a task that isn't waiting unfinished, as `ask` does", async () => {
    const state: TasksFile = { ...emptyTasks(), current: { id: "t0", action: "study", status: "running", startedAt: "", turns: 1 } };
    const t = setup({ state });
    await t.manager.startPrepared(PREPARED);
    expect(t.turns).toHaveLength(1);
    expect(t.state().actions.study).toBe("unfinished");
    expect(t.state().current).toMatchObject({ id: "t1", plugin: "on-this-day" });
  });

  it("D0: an ordinary question and an action call profileFor with the action alone, and carry no plugin", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    await t.manager.ask("What is a half?");
    await t.manager.start("study");
    expect(t.profileCalls).toEqual([[undefined], ["study"]]);
    expect(t.trailers).toEqual([{ task: "t1" }]);
    expect(t.state().current).not.toHaveProperty("plugin");
    expect(t.turns.every((x) => !("plugin" in x.options))).toBe(true);
  });

  it("is refused while a turn runs, like `ask` (same op queue)", async () => {
    let release!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (release = r)) });
    const first = t.manager.ask("What is a half?");
    await new Promise((r) => setTimeout(r, 0));
    await expect(t.manager.startPrepared(PREPARED)).rejects.toThrow(/A turn is already running/);
    await expect(t.manager.ask("again")).rejects.toThrow(/A turn is already running/);
    release();
    await first;
    expect(t.turns).toHaveLength(1);
  });

  describe("with scopes", () => {
    it('`scope: "none"` runs in _app and leaves the open scope open, like an app-wide action', async () => {
      const t = setup({ scoped: true });
      await t.manager.switchScope("fracciones");
      await t.manager.startPrepared({ ...PREPARED, scope: "none" });
      expect(t.turns[0].options).toMatchObject({ scope: "_app", chat: "fracciones" });
      expect(t.state().open).toBe("fracciones");
      expect(await t.manager.trailerNow()).toEqual({ task: "t1", scope: "_app", plugin: "on-this-day" });
    });

    it('`scope: "required"` runs in the open scope', async () => {
      const t = setup({ scoped: true });
      await t.manager.switchScope("fracciones");
      await t.manager.startPrepared({ ...PREPARED, scope: "required" });
      expect(t.turns[0].options).toMatchObject({ scope: "fracciones", chat: "fracciones" });
      expect(await t.manager.trailerNow()).toEqual({ task: "t1", scope: "fracciones", plugin: "on-this-day" });
    });

    it('`scope: "required"` with no scope open starts nothing and ends nothing', async () => {
      const state: TasksFile = { ...emptyTasks(), current: { id: "t0", status: "waiting", startedAt: "", turns: 1, scope: "_app" } };
      const t = setup({ scoped: true, state });
      await expect(t.manager.startPrepared({ ...PREPARED, scope: "required" })).rejects.toBeInstanceOf(ScopeRequired);
      expect(t.turns).toEqual([]);
      expect(t.state().current).toMatchObject({ id: "t0", status: "waiting" });
    });

    it("without a scope it runs where a free question would: _app when none is open", async () => {
      const t = setup({ scoped: true });
      await t.manager.startPrepared(PREPARED);
      expect(t.turns[0].options).toMatchObject({ scope: "_app", chat: "_app" });
    });
  });

  it('without scopes, "none" and "required" both run in main', async () => {
    for (const scope of ["none", "required"] as const) {
      const t = setup();
      await t.manager.startPrepared({ ...PREPARED, scope });
      expect(t.turns[0].options).not.toHaveProperty("scope");
      expect(t.state().current).not.toHaveProperty("scope");
    }
  });
});

describe("tasks.json keeps a task's plugin", () => {
  it("reads back a valid plugin id and drops an invalid one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-prepared-"));
    const store = new TaskStore(dir);
    const current = (plugin: string) => ({ id: "t1", status: "waiting" as const, startedAt: "", turns: 1, question: "q", plugin });
    try {
      await store.save({ ...emptyTasks(), current: current("on-this-day") });
      expect((await store.load()).current?.plugin).toBe("on-this-day");
      await store.save({ ...emptyTasks(), current: current("Bad Id/..") });
      expect((await store.load()).current).not.toHaveProperty("plugin");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
