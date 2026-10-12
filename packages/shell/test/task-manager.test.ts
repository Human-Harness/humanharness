import { describe, expect, it, vi } from "vitest";
import type { SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import type { Note, NoteMeta } from "@humanharness/workspace";
import { TaskManager } from "../src/main/task-manager";
import { CLOSE_PROMPT } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
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
function setup(opts: { script?: Event[][]; state?: TasksFile; path?: string[]; notes?: Note[]; gate?: Promise<void> } = {}) {
  let state = opts.state ?? emptyTasks();
  const notes: Note[] = [...(opts.notes ?? [])];
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const log: string[] = [];
  let busy = false;
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => busy,
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        log.push(`turn:${options.phase ?? "run"}`);
        await opts.gate;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { manifest: { label: label("The manifest", "El manifiesto") }, engines: { label: label("Engines", "Motores") }, turn: { label: label("A turn") } },
    path: opts.path ?? ["manifest", "engines", "turn"],
    readPrompt: async (action) => `# Topic: ${action}\nAnswer in {{language}}.\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [...notes],
    writeNote: async (slug: string, saved: SavedNote, meta: NoteMeta) => {
      log.push(`note:${slug}`);
      notes.unshift({ slug, path: `.harness/notes/${slug}.md`, ...saved, ...meta });
    },
    endSession: async () => void log.push("endSession"),
    saveHistory: async (message) => void log.push(`history:${message}`),
    changed: (v) => views.push(v),
    now: () => new Date("2026-10-12T11:20:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, log, state: () => state };
}

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
    await t.manager.choose({ label: "Next topic →", next: true });
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
    await t.manager.choose({ label: "Done", next: true });
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unsaved" } });
    expect(t.turns).toHaveLength(2);
  });

  it("keeps a follow-up option in the same task, showing its label", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Go deeper", followUp: "Explain validation in detail." });
    expect(t.turns[1]).toMatchObject({ message: "Explain validation in detail.", options: { task: "t1", display: "Go deeper", followUp: true } });
  });

  it("closes this task and starts the one an option names; an unknown action is a follow-up", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Compare with a turn", action: "turn" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "turn" });
    expect(t.turns[2].message).toContain("# Topic: turn");
    await t.manager.choose({ label: "Something else", action: "nope" });
    expect(t.turns[3]).toMatchObject({ message: "Something else", options: { task: "t2", followUp: true } });
  });

  it("skips the closing turn when the task already saved its note", async () => {
    const t = setup({ script: [[saveNote(), ok], [ok]] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Next", next: true });
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
    await t.manager.choose({ label: "Done", next: true });
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
    await t.manager.choose({ label: "Compare with a turn", action: "turn", next: true, followUp: "x" });
    expect(t.state().current).toMatchObject({ id: "t2", action: "turn" });
    await t.manager.choose({ label: "Next", next: true, followUp: "x" });
    expect(t.state().current).toMatchObject({ id: "t3", action: "engines" });
    await t.manager.choose({ label: "Tell me more" });
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

  it("refuses an unknown action", async () => {
    await expect(setup().manager.start("nope")).rejects.toThrow("Unknown action");
  });

  it("tells the window every change, with the notes", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await t.manager.choose({ label: "Done", next: true });
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
