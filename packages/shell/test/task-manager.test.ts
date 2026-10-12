import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { ChoiceOption, SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import type { Note, NoteMeta } from "@humanharness/workspace";
import { TaskManager } from "../src/main/task-manager";
import { CLOSE_PROMPT } from "../src/main/task-prompts";
import { type CurrentTask, type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const label = (en: string, es = en) => ({ es, en });
const note: SavedNote = {
  title: "The manifest",
  summary: ["It declares the harness"],
  decisions: ["Actions carry a brief"],
  files: ["packages/harness-sdk/src/index.ts"],
  open: [],
};
const saveNote = (data: unknown = note): Event => ({ type: "block", name: "save_note", data });
const ok: Event = { type: "done", ok: true };
const cancelled: Event = { type: "done", ok: false, error: { code: "cancelled" } };
const crashed: Event = { type: "done", ok: false, error: { code: "agent-crashed" } };

/** A task manager over memory: each turn plays the next script entry (just `done: ok` when none is left). */
function setup(
  opts: {
    script?: Event[][];
    state?: TasksFile;
    path?: string[];
    notes?: Note[];
    gate?: Promise<void>;
    /** Sends reject ("The app is closing") while this answers true. */
    closed?: () => boolean;
    /** Runs inside each turn (0-based index), before its events. */
    during?: (index: number) => void;
    /** Runs inside each `endSession` call. */
    onEndSession?: () => void;
    /** Runs inside each `notes` call. */
    onNotes?: () => void;
    /** Runs inside each tasks.json save, with what is saved. */
    onSave?: (s: TasksFile) => void;
    /** What profileFor answers for every new task. */
    profile?: ModelProfile;
    /** fallbackFor: the profile to retry with. */
    fallback?: (p: ModelProfile, tried: string[]) => ModelProfile | null;
    /** recordCompaction. */
    recordCompaction?: (task: CurrentTask) => void;
  } = {},
) {
  let state = opts.state ?? emptyTasks();
  const notes: Note[] = [...(opts.notes ?? [])];
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const log: string[] = [];
  const emitted: Event[] = [];
  let busy = false;
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
        opts.onSave?.(s);
      },
    },
    turns: {
      isBusy: () => busy,
      cancel: () => void log.push("cancel"),
      send: async (message, options) => {
        if (opts.closed?.()) throw new Error("The app is closing");
        busy = true;
        turns.push({ message, options });
        log.push(`turn:${options.phase ?? "run"}`);
        await opts.gate;
        opts.during?.(turns.length - 1);
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { manifest: { label: label("The manifest", "El manifiesto") }, engines: { label: label("Engines", "Motores") }, turn: { label: label("A turn") } },
    path: opts.path ?? ["manifest", "engines", "turn"],
    readPrompt: async (action) => `# Topic: ${action}\nAnswer in {{language}}.\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => {
      opts.onNotes?.();
      return [...notes];
    },
    writeNote: async (slug: string, saved: SavedNote, meta: NoteMeta) => {
      log.push(`note:${slug}`);
      notes.unshift({ slug, path: `.harness/notes/${slug}.md`, ...saved, ...meta });
    },
    endSession: async () => {
      log.push("endSession");
      opts.onEndSession?.();
    },
    saveHistory: async (message) => void log.push(`history:${message}`),
    changed: (v) => views.push(v),
    emit: (e) => void emitted.push(e),
    ...(opts.profile ? { profileFor: async () => opts.profile! } : {}),
    ...(opts.fallback ? { fallbackFor: async (p: ModelProfile, tried: string[]) => opts.fallback!(p, tried) } : {}),
    ...(opts.recordCompaction ? { recordCompaction: async (task: CurrentTask) => opts.recordCompaction!(task) } : {}),
    now: () => new Date("2026-10-12T11:20:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, log, emitted, state: () => state };
}

/** Picks an option of the block shown for the task open now. */
const pick = (t: ReturnType<typeof setup>, option: ChoiceOption) => t.manager.choose(option, t.state().current?.id ?? "none");

describe("TaskManager", () => {
  it("starts an action in a fresh session: its brief with the notes index is the first message", async () => {
    const engines: Note = {
      slug: "engines",
      path: ".harness/notes/engines.md",
      title: "Engines",
      action: "engines",
      date: "2026-10-11T10:00:00.000Z",
      engine: "codex",
      summary: ["Detected on every start"],
      decisions: [],
      files: [],
      open: [],
    };
    const t = setup({ notes: [engines] });
    await t.manager.start("manifest", "The manifest");
    expect(t.log).toEqual(["endSession", "turn:run"]);
    const [first] = t.turns;
    expect(first.message).toContain("# Topic: manifest\nAnswer in English.");
    expect(first.message).toContain("## What we already covered\n- Engines (engines): Detected on every start → .harness/notes/engines.md");
    expect(first.options).toMatchObject({ action: "manifest", task: "t1", display: "The manifest", phase: "run" });
    expect(t.state()).toMatchObject({ engine: "claude", current: { id: "t1", action: "manifest", status: "waiting", turns: 1 } });
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "manifest", status: "waiting" });
  });

  it("shows an action's label in the configured language when no display text is given", async () => {
    const t = setup();
    await t.manager.start("engines");
    expect(t.turns[0].options.display).toBe("Engines");
  });

  it("sends a typed message as a follow-up of the waiting task", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.ask("And the blocks?");
    expect(t.turns[1]).toMatchObject({ message: "And the blocks?", options: { task: "t1", action: "manifest", followUp: true } });
    expect(t.log.filter((l) => l === "endSession")).toHaveLength(1);
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 2 });
  });

  it("starts a free question as its own task", async () => {
    const t = setup();
    await t.manager.ask("Where are chats saved?");
    expect(t.turns[0].message).toContain("## Question\nWhere are chats saved?");
    expect(t.turns[0].options).toMatchObject({ task: "t1", display: "Where are chats saved?" });
    expect(t.turns[0].options.action).toBeUndefined();
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting", question: "Where are chats saved?" });
  });

  it("on next: closes with a quiet turn, writes the note, then starts the next topic from the index", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await pick(t, { label: "Next topic →", next: true });
    expect(t.turns[1]).toMatchObject({ message: CLOSE_PROMPT, options: { task: "t1", action: "manifest", phase: "close", quiet: true } });
    expect(t.log).toEqual(["endSession", "turn:run", "turn:close", "note:manifest", "history:Note: The manifest", "endSession", "endSession", "turn:run"]);
    expect(t.state().actions).toEqual({ manifest: "done" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "engines", status: "waiting" });
    expect(t.turns[2].message).toContain("- The manifest (manifest): It declares the harness → .harness/notes/manifest.md");
    expect(t.turns[2].options.display).toBe("Engines");
  });

  it("marks the topic unsaved when the closing turn brings no valid note", async () => {
    const t = setup({ script: [[ok], [saveNote({ title: "" }), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await pick(t, { label: "Done", next: true });
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unsaved" } });
    expect(t.turns).toHaveLength(2);
  });

  it("keeps a follow-up option in the same task, showing its label", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await pick(t, { label: "Go deeper", followUp: "Explain validation in detail." });
    expect(t.turns[1]).toMatchObject({ message: "Explain validation in detail.", options: { task: "t1", display: "Go deeper", followUp: true } });
  });

  it("closes this task and starts the one an option names; an unknown action is a follow-up", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await pick(t, { label: "Compare with a turn", action: "turn" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "turn" });
    expect(t.turns[2].message).toContain("# Topic: turn");
    await pick(t, { label: "Something else", action: "nope" });
    expect(t.turns[3]).toMatchObject({ message: "Something else", options: { task: "t2", followUp: true } });
  });

  it("skips the closing turn when the task already saved its note", async () => {
    const t = setup({ script: [[saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "run"]);
    expect(t.state().actions.manifest).toBe("done");
  });

  it("ends the task as unfinished when a turn is cancelled or its first turn fails; a later failure keeps it", async () => {
    const t = setup({ script: [[cancelled]] });
    await t.manager.start("manifest");
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
    expect(t.log.at(-1)).toBe("endSession");

    const u = setup({ script: [[crashed]] });
    await u.manager.start("turn");
    expect(u.state()).toMatchObject({ current: null, actions: { turn: "unfinished" } });

    const v = setup({ script: [[ok], [crashed]] });
    await v.manager.start("engines");
    await v.manager.ask("again?");
    expect(v.state().current).toMatchObject({ action: "engines", status: "waiting" });
  });

  it("interrupt ends the open task without a note, keeping a topic that was already done", async () => {
    const open: TasksFile = {
      ...emptyTasks(),
      actions: { manifest: "done" },
      current: { id: "t9", action: "manifest", status: "waiting", startedAt: "t", turns: 1 },
    };
    const t = setup({ state: open });
    await t.manager.interrupt();
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "done" } });
    expect(t.log).toEqual(["endSession"]);
    const u = setup({ state: { ...open, actions: {} } });
    await u.manager.interrupt();
    expect(u.state().actions).toEqual({ manifest: "unfinished" });
  });

  it("saves a free question's note under a q- slug", async () => {
    const t = setup({ script: [[ok], [saveNote({ ...note, title: "Where chats live" }), ok]], path: [] });
    await t.manager.ask("Where are chats saved?");
    await pick(t, { label: "Done", next: true });
    expect(t.log).toContain("note:q-where-chats-live");
    expect(t.state()).toMatchObject({ current: null, actions: {} });
  });

  it("never overwrites another free question's note: the slug gets a number, and the same task keeps its own", async () => {
    const other = (slug: string): Note => ({ ...note, slug, path: `.harness/notes/${slug}.md`, title: "Where chats live", date: "2026-10-11T10:00:00.000Z", engine: "claude" });
    const t = setup({
      script: [[saveNote({ ...note, title: "Where chats live" }), ok], [saveNote({ ...note, title: "Where chats live" }), ok]],
      notes: [other("q-where-chats-live"), other("q-where-chats-live-2")],
      path: [],
    });
    await t.manager.ask("Where are chats saved?");
    await t.manager.ask("And the archived ones?");
    expect(t.log.filter((l) => l.startsWith("note:"))).toEqual(["note:q-where-chats-live-3", "note:q-where-chats-live-3"]);
  });

  it("follows an option's action first, then next, then followUp; a bare label is a follow-up", async () => {
    const t = setup({ script: [[saveNote(), ok], [saveNote(), ok], [saveNote(), ok]] });
    await t.manager.start("manifest");
    await pick(t, { label: "Compare with a turn", action: "turn", next: true, followUp: "x" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "turn" });
    await pick(t, { label: "Next", next: true, followUp: "x" });
    expect(t.state().current).toMatchObject({ id: "t3", action: "engines" });
    await pick(t, { label: "Tell me more" });
    expect(t.turns.at(-1)).toMatchObject({ message: "Tell me more", options: { task: "t3", display: "Tell me more", followUp: true } });
  });

  it("refuses a second operation while one runs, and records the session the engine started", async () => {
    let open!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (open = r)) });
    const first = t.manager.start("manifest");
    await expect(t.manager.ask("hi")).rejects.toThrow("A turn is already running");
    expect(t.manager.isBusy()).toBe(true);
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    await t.manager.sessionStarted({ id: "s-1", started: true });
    open();
    await first;
    expect(t.state().current?.session).toEqual({ id: "s-1", started: true });
    expect(t.manager.isBusy()).toBe(false);
  });

  it("does not start the next task when the closing turn is cancelled, and tells the window the turn stopped", async () => {
    const t = setup({ script: [[ok], [cancelled]] });
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.turns).toHaveLength(2);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
    // The window already shows the next topic as a running turn: this done clears it.
    expect(t.emitted).toEqual([cancelled]);
  });

  it("starting a topic whose closing turn is cancelled tells the window the turn stopped", async () => {
    const t = setup({ script: [[ok], [cancelled]] });
    await t.manager.start("manifest");
    await t.manager.start("engines");
    expect(t.turns).toHaveLength(2);
    expect(t.emitted).toEqual([cancelled]);
  });

  it("at the end of the path, a cancelled closing turn sends nothing (the window shows no running turn)", async () => {
    const t = setup({ script: [[ok], [cancelled]], path: ["manifest"] });
    await t.manager.start("manifest");
    await pick(t, { label: "Done", next: true });
    expect(t.emitted).toEqual([]);
  });

  it("a closing turn whose failure the window already showed is not followed by another done", async () => {
    let manager!: TaskManager;
    const t = setup({ script: [[ok], [crashed]], during: (i) => void (i === 1 && manager.cancel()) });
    manager = t.manager;
    await t.manager.start("manifest");
    // A quiet turn that fails (not cancelled) reaches the window by itself (TurnController).
    await pick(t, { label: "Next", next: true });
    expect(t.turns).toHaveLength(2);
    expect(t.emitted).toEqual([]);
  });

  it("cancel during endSession before the first turn: no turn, no task, no topic marked, the window told", async () => {
    let manager!: TaskManager;
    const t = setup({ onEndSession: () => manager.cancel() });
    manager = t.manager;
    await t.manager.start("manifest");
    expect(t.turns).toHaveLength(0);
    expect(t.state()).toMatchObject({ current: null, actions: {} });
    expect(t.emitted).toEqual([cancelled]);
  });

  it("cancel while the notes are read before the first turn: no turn, no task, the window told", async () => {
    let manager!: TaskManager;
    const t = setup({ onNotes: () => manager.cancel() });
    manager = t.manager;
    await t.manager.ask("Where are chats saved?");
    expect(t.turns).toHaveLength(0);
    expect(t.state()).toMatchObject({ current: null, actions: {} });
    expect(t.emitted).toEqual([cancelled]);
  });

  it("refuses a pick from a block of an earlier task: nothing runs and the open task stays as it was", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.state().current).toMatchObject({ id: "t2", status: "waiting" });
    await expect(t.manager.choose({ label: "Go deeper" }, "t1")).rejects.toThrow("earlier task");
    await expect(t.manager.choose({ label: "Next", next: true }, "t1")).rejects.toThrow("earlier task");
    expect(t.turns).toHaveLength(3);
    expect(t.state().current).toMatchObject({ id: "t2", action: "engines", status: "waiting", turns: 1 });
  });

  it("cancel while a follow-up marks the task running: no turn, the task waits again, the window told", async () => {
    let manager!: TaskManager;
    let armed = false;
    const t = setup({ onSave: (s) => void (armed && s.current?.status === "running" && manager.cancel()) });
    manager = t.manager;
    await t.manager.start("manifest");
    armed = true;
    await t.manager.ask("And the blocks?");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting", turns: 1 });
    expect(t.emitted).toEqual([cancelled]);
  });

  it("cancel while the task is marked closing: no closing turn, the task waits again, nothing new starts", async () => {
    let manager!: TaskManager;
    const t = setup({ onSave: (s) => void (s.current?.status === "closing" && manager.cancel()) });
    manager = t.manager;
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.turns).toHaveLength(1);
    expect(t.state()).toMatchObject({ current: { id: "t1", status: "waiting" }, actions: {} });
    expect(t.emitted).toEqual([cancelled]);
  });

  it("a normal turn sends no extra done", async () => {
    const t = setup({ script: [[ok], [cancelled]] });
    await t.manager.start("manifest");
    await t.manager.ask("more?");
    expect(t.emitted).toEqual([]);
  });

  it("does not start the next task when cancel comes after the closing turn has ended", async () => {
    let manager!: TaskManager;
    const during = (i: number) => {
      if (i === 1) manager.cancel();
    };
    const u = setup({ script: [[ok], [saveNote(), ok]], during: (i) => during(i) });
    manager = u.manager;
    await u.manager.start("manifest");
    await pick(u, { label: "Next", next: true });
    expect(u.turns).toHaveLength(2);
    expect(u.log).toContain("cancel");
    expect(u.state()).toMatchObject({ current: null, actions: { manifest: "done" } });
    expect(u.emitted).toEqual([cancelled]);
  });

  it("when the app starts closing during the closing turn, the next task never starts and no topic is marked", async () => {
    let closed = false;
    const t = setup({ script: [[ok], [saveNote(), ok]], closed: () => closed, during: (i) => void (i === 1 && (closed = true)) });
    await t.manager.start("manifest");
    await expect(pick(t, { label: "Next", next: true })).rejects.toThrow("The app is closing");
    expect(t.turns).toHaveLength(2);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "done" } });
    expect(t.state().actions).not.toHaveProperty("engines");
  });

  it("quitting during the closing turn: the next task never starts and the window is told the turn stopped", async () => {
    let manager!: TaskManager;
    const t = setup({ script: [[ok], [saveNote(), ok]], during: (i) => void (i === 1 && manager.close()) });
    manager = t.manager;
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.turns).toHaveLength(2);
    expect(t.emitted).toEqual([cancelled]);
  });

  it("a first turn that never starts leaves no task and no topic status, and the call rejects", async () => {
    const t = setup({ closed: () => true });
    await expect(t.manager.start("manifest")).rejects.toThrow("The app is closing");
    expect(t.state()).toMatchObject({ current: null, actions: {} });
  });

  it("a follow-up that never starts keeps the task waiting, and the call rejects", async () => {
    let closed = false;
    const t = setup({ closed: () => closed });
    await t.manager.start("manifest");
    closed = true;
    await expect(t.manager.ask("more?")).rejects.toThrow("The app is closing");
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting", turns: 1 });
  });

  it("refuses every operation once closed", async () => {
    const t = setup();
    t.manager.close();
    await expect(t.manager.start("manifest")).rejects.toThrow("The app is closing");
    await expect(t.manager.ask("hi")).rejects.toThrow("The app is closing");
    expect(t.turns).toHaveLength(0);
  });

  it("ignores a session reported when no turn of the task runs", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.sessionStarted({ id: "s-late", started: true });
    expect(t.state().current?.session).toBeUndefined();
  });

  it("refuses an unknown action", async () => {
    await expect(setup().manager.start("nope")).rejects.toThrow("Unknown action");
  });

  it("tells the window every change, with the notes", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await pick(t, { label: "Done", next: true });
    expect(t.views.map((v) => v.current?.status ?? "idle")).toContain("closing");
    expect(t.views.at(-1)).toEqual({
      current: null,
      actions: { manifest: "done" },
      notes: [
        {
          slug: "manifest",
          title: "The manifest",
          action: "manifest",
          date: "2026-10-12T11:20:00.000Z",
          summary: ["It declares the harness"],
          decisions: ["Actions carry a brief"],
          path: ".harness/notes/manifest.md",
        },
      ],
    });
    expect(await t.manager.view()).toEqual(t.views.at(-1));
  });
});

describe("TaskManager model profiles", () => {
  const deep: ModelProfile = { engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000 };
  const standard: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000, fallbackFrom: "opus" };
  const light: ModelProfile = { engine: "claude", tier: "light", model: "haiku", effort: "low", cap: 100_000, fallbackFrom: "opus" };
  const unavailable: Event = { type: "done", ok: false, error: { code: "model-unavailable" } };

  it("resolves the profile when the task starts and runs every turn of the task on it", async () => {
    const t = setup({ profile: deep });
    await t.manager.start("manifest");
    await t.manager.ask("More?");
    await pick(t, { label: "Next", next: true });
    expect(t.turns.slice(0, 3).map((x) => [x.options.phase, x.options.profile])).toEqual([["run", deep], ["run", deep], ["close", deep]]);
    expect(t.state().current?.profile).toEqual(deep);
  });

  it("runs without a profile when none is resolved", async () => {
    const t = setup();
    await t.manager.start("manifest");
    expect(t.turns[0].options.profile).toBeUndefined();
    expect(t.state().current?.profile).toBeUndefined();
  });

  it("retries a first turn the plan can't run on the next profile down, in a fresh session, and keeps it", async () => {
    const t = setup({ profile: deep, fallback: (p) => (p.model === "opus" ? standard : null), script: [[unavailable]] });
    await t.manager.start("manifest", "The manifest");
    expect(t.log).toEqual(["endSession", "turn:run", "endSession", "turn:run"]);
    expect(t.turns[0].options).toMatchObject({ profile: deep, holdModelError: true });
    expect(t.turns[0].options.skipUserEntry).toBeUndefined();
    expect(t.turns[1].options).toMatchObject({ profile: standard, skipUserEntry: true, display: "The manifest" });
    expect(t.turns[1].message).toBe(t.turns[0].message);
    expect(t.state().current).toMatchObject({ status: "waiting", profile: standard });
    expect(t.views.at(-1)?.current?.fallback).toEqual({ model: "opus", tier: "standard" });
    expect(t.emitted).toEqual([]);
  });

  it("shows the failure when nothing is left to fall back to", async () => {
    const t = setup({ profile: deep, fallback: () => null, script: [[unavailable]] });
    await t.manager.start("manifest");
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0].options.holdModelError).toBeUndefined();
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
  });

  it("walks the chain, telling the fallback which models failed", async () => {
    const asked: string[][] = [];
    const t = setup({
      profile: deep,
      fallback: (p, tried) => {
        asked.push([...tried]);
        return p.model === "opus" ? standard : p.model === "sonnet" ? light : null;
      },
      script: [[unavailable], [unavailable]],
    });
    await t.manager.start("manifest");
    expect(t.turns.map((x) => x.options.profile?.model)).toEqual(["opus", "sonnet", "haiku"]);
    expect(asked).toEqual([[], ["opus"], ["opus", "sonnet"]]);
    expect(t.views.at(-1)?.current?.fallback).toEqual({ model: "opus", tier: "light" });
  });

  it("says the engine's default model ran when the chain ended there", async () => {
    const engineDefault: ModelProfile = { engine: "claude", tier: "light", effort: "low", cap: 100_000, fallbackFrom: "opus" };
    const t = setup({ profile: deep, fallback: (p) => (p.model ? engineDefault : null), script: [[unavailable]] });
    await t.manager.start("manifest");
    expect(t.views.at(-1)?.current?.fallback).toEqual({ model: "opus" });
  });

  it("cancel after a held failure: no retry, and the window is told the turn stopped", async () => {
    let t!: ReturnType<typeof setup>;
    t = setup({ profile: deep, fallback: () => standard, script: [[unavailable]], during: () => t.manager.cancel() });
    await t.manager.start("manifest");
    expect(t.turns).toHaveLength(1);
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
  });

  it("cancel while the failed session ends: no retry, and the window is told the turn stopped", async () => {
    let ends = 0;
    let t!: ReturnType<typeof setup>;
    t = setup({
      profile: deep,
      fallback: () => standard,
      script: [[unavailable]],
      onEndSession: () => {
        if (++ends === 2) t.manager.cancel();
      },
    });
    await t.manager.start("manifest");
    expect(t.turns).toHaveLength(1);
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
  });
});
