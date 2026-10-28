import { describe, expect, it } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { SavedNote, Tier } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { LaneStore } from "../src/main/lane-store";
import { TaskBoard } from "../src/main/task-board";
import { TaskManager } from "../src/main/task-manager";
import type { CurrentTask, TasksFile } from "../src/main/task-store";

const ok: Event = { type: "done", ok: true };
const NOTE: SavedNote = { title: "Halves", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const profileOf = (tier: Tier): ModelProfile => ({ engine: "claude", tier, model: tier === "deep" ? "opus" : "sonnet", effort: "medium", cap: 200_000 });

/**
 * A board whose lanes are real TaskManagers over LaneStores of one memory tasks.json, wired as the board host wires
 * them: `successor` hands the next task to the board, `changed` is the lane-ended hook. Turns play `script` in order.
 */
function lanes(o: { script?: Event[][]; init?: Partial<TasksFile>; scoped?: boolean } = {}) {
  let file: TasksFile = { version: 1, current: null, actions: {}, lanes: [], ...o.init };
  const store = { load: async () => structuredClone(file), save: async (s: TasksFile) => void (file = structuredClone(s)) };
  const script = [...(o.script ?? [])];
  const sent: { lane: string; message: string }[] = [];
  const managers = new Map<string, TaskManager>();
  let n = 0;
  const board: TaskBoard = new TaskBoard({
    file: store,
    newId: () => `t${++n}`,
    changed: () => {},
    newLane: (id) => {
      let busy = false;
      const m = new TaskManager({
        store: new LaneStore(store, id),
        turns: {
          isBusy: () => busy,
          cancel: () => {},
          send: async (message, options) => {
            busy = true;
            sent.push({ lane: id, message });
            await Promise.resolve();
            for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
            busy = false;
          },
        },
        actions: { study: { label: "Study", modes: ["socratic", "worked"], defaultMode: "socratic" }, quiz: { label: "Quiz" } },
        modes: { socratic: { label: "Socratic" }, worked: { label: "Worked examples", minTier: "deep" } },
        readModeBrief: async (mode) => `Brief of ${mode}.`,
        tierOf: async (p) => (p.tier === "custom" ? "standard" : p.tier),
        profileFor: async (_action, floor) => profileOf(floor ?? "standard"),
        ...(o.scoped ? { scoped: true } : {}),
        path: ["study", "quiz"],
        readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
        language: async () => "en",
        engine: async () => "claude",
        notes: async () => [],
        writeNote: async () => {},
        endSession: async () => {},
        changed: () => void board.laneSettled(id),
        now: () => new Date("2026-10-28T10:00:00.000Z"),
        newId: () => id,
        successor: (start) => board.handOver((next) => start(managers.get(next.id)!), id),
      });
      managers.set(id, m);
      return Object.assign(m, { id });
    },
  });
  const open = () => (file.lanes ?? []).map((l) => [l.id, l.action ?? null]);
  return { board, file: () => file, sent, open, managers };
}

const task = (id: string, extra: Partial<CurrentTask> = {}): CurrentTask => ({ id, action: "quiz", status: "waiting", startedAt: "2026-10-28T09:00:00Z", turns: 1, ...extra });

describe("a task that follows another starts in a lane of its own (parallel spec §6)", () => {
  it("the guided path's next: the task closes with its note; the next one starts in a new lane, focused", async () => {
    const t = lanes({ script: [[ok], [saveNote, ok], [ok]] });
    await t.board.start("study");
    await t.board.choose({ label: "Next", next: true }, "t1");
    expect(t.open()).toEqual([["t2", "quiz"]]);
    expect(t.board.laneIds()).toEqual(["t2"]);
    expect(t.file().focus).toBe("t2");
    expect(t.file().actions.study).toBe("done");
    expect(t.sent.map((s) => s.lane)).toEqual(["t1", "t1", "t2"]);
  });
  it("another open task stays open meanwhile; the end of the path just closes the lane", async () => {
    const t = lanes({ script: [[ok], [ok], [saveNote, ok]], init: { actions: { study: "done" } } });
    await t.board.start("quiz");
    await t.board.start("study");
    await t.board.focus("t1");
    await t.board.choose({ label: "Next", next: true }, "t1");
    expect(t.open()).toEqual([["t2", "study"]]);
    expect(t.board.laneIds()).toEqual(["t2"]);
    expect(t.file().focus).toBeNull();
  });
  it("a mode below the task's tier, as a new task: the same action starts in a new lane at the mode's tier", async () => {
    const t = lanes({ script: [[ok], [saveNote, ok], [ok]] });
    await t.board.start("study");
    const { accepted, done } = t.board.chooseMode("worked", { belowTier: "new-task" });
    expect(await accepted).toEqual({ ok: true, switched: "new-task" });
    await done;
    expect(t.board.laneIds()).toEqual(["t2"]);
    expect(t.file().lanes?.[0]).toMatchObject({ id: "t2", action: "study", mode: "worked", profile: { tier: "deep" } });
  });
  it("a question once the task stopped waiting ends it and starts a new task in a new lane", async () => {
    const t = lanes({ init: { lanes: [task("old", { status: "running" })], focus: "old" } });
    await t.board.restore();
    await t.board.ask("And then?");
    expect(t.board.laneIds()).toEqual(["t1"]);
    expect(t.open()).toEqual([["t1", null]]);
    expect(t.file().actions.quiz).toBe("unfinished");
    expect(t.file().focus).toBe("t1");
  });
  it("a question for another scope closes the task in its scope and starts the new one in a new lane", async () => {
    const t = lanes({ scoped: true, script: [[ok], [saveNote, ok], [ok]], init: { open: "s1" } });
    await t.board.start("quiz");
    await t.board.ask("Something else", undefined, "s2");
    expect(t.board.laneIds()).toEqual(["t2"]);
    expect(t.file().lanes).toEqual([expect.objectContaining({ id: "t2", scope: "s2" })]);
    expect(t.file().open).toBe("s2");
  });
  it("D0: without `successor` a manager starts the next task itself, as today", async () => {
    let file: TasksFile = { version: 1, current: null, actions: {} };
    let n = 0;
    const m = new TaskManager({
      store: { load: async () => structuredClone(file), save: async (s) => void (file = structuredClone(s)) },
      turns: { isBusy: () => false, cancel: () => {}, send: async (_m, options) => options.onEvent?.(ok) },
      actions: { study: { label: "Study" }, quiz: { label: "Quiz" } },
      path: ["study", "quiz"],
      readPrompt: async () => "x",
      language: async () => "en",
      engine: async () => "claude",
      notes: async () => [],
      writeNote: async () => {},
      endSession: async () => {},
      changed: () => {},
      newId: () => `t${++n}`,
    });
    await m.start("study");
    await m.choose({ label: "Next", next: true }, "t1");
    expect(file.current).toMatchObject({ id: "t2", action: "quiz" });
  });
});
