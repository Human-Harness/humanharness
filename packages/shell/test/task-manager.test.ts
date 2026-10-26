import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { ChoiceOption, SavedNote } from "@humanharness/harness-sdk";
import type { Event, HarnessRuntime } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import type { Note, NoteMeta } from "@humanharness/workspace";
import { type TaskDeps, TaskManager } from "../src/main/task-manager";
import { CHECKPOINT_PROMPT, CLOSE_PROMPT } from "../src/main/task-prompts";
import { type CurrentTask, QUESTION_MAX, type TasksFile, emptyTasks } from "../src/main/task-store";
import { TurnController, type TurnOptions } from "../src/main/turn-controller";

const label = (en: string) => en;
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
    /** fitProfile: a stored profile fitted to what its engine offers now. */
    fit?: (p: ModelProfile) => ModelProfile;
    /** recordCompaction. */
    recordCompaction?: (task: CurrentTask) => void;
    /** betweenTasks: logged as "between", then this runs. */
    betweenTasks?: () => void;
    /** readPrompt instead of the default brief. */
    readPrompt?: (action: string) => Promise<string>;
    /** Real turns (a TurnController) instead of the scripted ones; `window` then gets the manager's events too. */
    turns?: TaskDeps["turns"];
    window?: Event[];
  } = {},
) {
  let state = opts.state ?? emptyTasks();
  const notes: Note[] = [...(opts.notes ?? [])];
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const log: string[] = [];
  const emitted: Event[] = [];
  const trailers: unknown[] = [];
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
    turns: opts.turns ?? {
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
    actions: { manifest: { label: label("The manifest") }, engines: { label: label("Engines") }, turn: { label: label("A turn") } },
    path: opts.path ?? ["manifest", "engines", "turn"],
    readPrompt: opts.readPrompt ?? (async (action) => `# Topic: ${action}\nAnswer in {{language}}.\n\n{{notesIndex}}`),
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
    saveHistory: async (message, trailer) => {
      log.push(`history:${message}`);
      trailers.push(trailer);
    },
    changed: (v) => views.push(v),
    emit: (e) => void (opts.window ?? emitted).push(e),
    ...(opts.profile ? { profileFor: async () => opts.profile! } : {}),
    ...(opts.fallback ? { fallbackFor: async (p: ModelProfile, tried: string[]) => opts.fallback!(p, tried) } : {}),
    ...(opts.fit ? { fitProfile: async (p: ModelProfile) => opts.fit!(p) } : {}),
    ...(opts.recordCompaction ? { recordCompaction: async (task: CurrentTask) => opts.recordCompaction!(task) } : {}),
    ...(opts.betweenTasks
      ? {
          betweenTasks: async () => {
            log.push("between");
            opts.betweenTasks!();
          },
        }
      : {}),
    now: () => new Date("2026-10-12T11:20:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, log, emitted, trailers, state: () => state };
}

/** Picks an option of the block shown for the task open now. */
const pick = (t: ReturnType<typeof setup>, option: ChoiceOption) => t.manager.choose(option, t.state().current?.id ?? "none");

describe("TaskManager", () => {
  it("after the folder moved, the open task's next message starts a fresh session from the notes", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting", resume: true });
    expect(t.state().current?.session).toBeUndefined();
    await t.manager.ask("And the blocks?");
    // The new session is told what the task is: the action's brief, filled as at its start, with the notes index.
    expect(t.turns[1].message.startsWith("# Topic: manifest\nAnswer in English.")).toBe(true);
    expect(t.turns[1].message).toContain("The earlier conversation of this topic is not available");
    expect(t.turns[1].message).toContain("## The person's message\nAnd the blocks?");
    expect(t.turns[1].options).toMatchObject({ task: "t1", action: "manifest", display: "And the blocks?", followUp: true });
    expect(t.log.filter((l) => l === "endSession")).toHaveLength(2);
    expect(t.state().current?.resume).toBeUndefined();
    await t.manager.ask("More?");
    expect(t.turns[2].message).toBe("More?");
  });

  it("keeps resuming from the notes when that first turn failed: the next message carries the brief again", async () => {
    const t = setup({ script: [[ok], [crashed], [ok]] });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    expect(t.state().current).toMatchObject({ status: "waiting", resume: true });
    await t.manager.ask("Again?");
    expect(t.turns[2].message.startsWith("# Topic: manifest")).toBe(true);
    expect(t.turns[2].message).toContain("## The person's message\nAgain?");
    expect(t.state().current?.resume).toBeUndefined();
  });

  it("the resumed message carries the notes index", async () => {
    const notes: Note[] = [{ slug: "engines", path: ".harness/notes/engines.md", ...note, title: "Engines", action: "engines", date: "d", engine: "claude" }];
    const t = setup({ notes });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    expect(t.turns[1].message).toContain(".harness/notes/engines.md");
  });

  it("a resumed free question carries the question that opened it", async () => {
    const t = setup();
    await t.manager.ask("Where is the chat kept?");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the notes?");
    expect(t.turns[1].message).toContain("## The question that opened this topic\nWhere is the chat kept?");
    expect(t.turns[1].message).toContain("## The person's message\nAnd the notes?");
  });

  it("a cancelled resumed follow-up ends the task unfinished", async () => {
    const t = setup({ script: [[ok], [cancelled]] });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
  });

  it("a follow-up option while resumed sends the resume message", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await pick(t, { label: "Tell me more" });
    expect(t.turns[1].message.startsWith("# Topic: manifest")).toBe(true);
    expect(t.turns[1].message).toContain("## The person's message\nTell me more");
    expect(t.turns[1].options).toMatchObject({ display: "Tell me more", followUp: true });
  });

  it("after a resumed turn went well, closing runs the closing turn again", async () => {
    const t = setup({ path: ["manifest", "engines"] });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    await pick(t, { label: "Next", next: true });
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "run", "close", "run"]);
  });

  it("a resumed turn whose model isn't in the plan retries on the next profile down", async () => {
    const deep: ModelProfile = { engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 200_000 };
    const standard: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };
    const t = setup({
      profile: deep,
      fallback: (p) => (p.model === "opus" ? { ...standard, fallbackFrom: "opus" } : null),
      script: [[ok], [{ type: "done", ok: false, error: { code: "model-unavailable" } }], [ok]],
    });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    expect(t.turns.map((x) => x.options.profile?.model)).toEqual(["opus", "opus", "sonnet"]);
    expect(t.turns[2].message).toBe(t.turns[1].message);
    expect(t.turns[2].options).toMatchObject({ followUp: true, skipUserEntry: true });
    expect(t.state().current).toMatchObject({ status: "waiting", profile: { model: "sonnet" } });
    expect(t.state().current?.resume).toBeUndefined();
  });

  it("before a move, a waiting task without a checkpoint note saves one first", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]] });
    await t.manager.start("manifest");
    await t.manager.checkpointBeforeMove();
    expect(t.turns[1]).toMatchObject({ message: CHECKPOINT_PROMPT, options: { phase: "checkpoint", quiet: true } });
    expect(t.log).toContain("note:manifest");
    expect(t.state().current).toMatchObject({ status: "waiting", checkpointNote: true });
    // Not again while that note stands.
    await t.manager.checkpointBeforeMove();
    expect(t.turns).toHaveLength(2);
  });

  it("before a move, a checkpoint runs again when a turn ran after the last one", async () => {
    const standard: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };
    const ctx = (used: number): Event => ({ type: "context", used });
    // The follow-up after the 80% checkpoint isn't in that note: the move needs a newer one.
    const t = setup({ profile: standard, script: [[ctx(170_000), ok], [saveNote(), ok], [ctx(175_000), ok], [saveNote(), ok]] });
    await t.manager.start("manifest");
    await t.manager.ask("And the blocks?");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "run"]);
    await t.manager.checkpointBeforeMove();
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "run", "checkpoint"]);
    expect(t.state().current).toMatchObject({ status: "waiting", checkpointNote: true, checkpointTurns: 2 });
    // Nothing ran since: not again.
    await t.manager.checkpointBeforeMove();
    expect(t.turns).toHaveLength(4);
  });

  it("before a move, a checkpoint note from an older file (no turn count) is taken as stale", async () => {
    const state: TasksFile = {
      version: 1,
      current: { id: "t9", action: "manifest", status: "waiting", startedAt: "", turns: 3, checkpointNote: true, session: { id: "s1", started: true } },
      actions: {},
    };
    const t = setup({ state, script: [[saveNote(), ok]] });
    await t.manager.checkpointBeforeMove();
    expect(t.turns.map((x) => x.options.phase)).toEqual(["checkpoint"]);
    expect(t.state().current).toMatchObject({ checkpointTurns: 3 });
  });

  it("a resumed task whose brief can't be read resumes without it, and says why in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = false;
    const t = setup({
      readPrompt: async (action) => {
        if (fail) throw new Error("ENOENT");
        return `# Topic: ${action}\n{{notesIndex}}`;
      },
    });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    fail = true;
    await t.manager.ask("And the blocks?");
    expect(t.turns[1].message).not.toContain("# Topic:");
    expect(t.turns[1].message).toContain("The earlier conversation of this topic is not available");
    expect(t.turns[1].message).toContain("## The person's message\nAnd the blocks?");
    expect(t.state().current).toMatchObject({ status: "waiting" });
    expect(t.state().current?.resume).toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("a resumed free question carries the whole question, and says so when a very long one was cut", async () => {
    const long = `${"a".repeat(1000)}END`;
    const t = setup();
    await t.manager.ask(long);
    expect(t.state().current?.question).toBe(long);
    await t.manager.resumeFromNotes();
    await t.manager.ask("And?");
    expect(t.turns[1].message).toContain(`## The question that opened this topic\n${long}`);
    expect(t.turns[1].message).not.toContain("was cut");

    const huge = "b".repeat(QUESTION_MAX + 50);
    const u = setup();
    await u.manager.ask(huge);
    expect(u.state().current).toMatchObject({ question: huge.slice(0, QUESTION_MAX), questionCut: true });
    await u.manager.resumeFromNotes();
    await u.manager.ask("And?");
    expect(u.turns[1].message).toContain("(The question was longer; it was cut here.)");
  });

  it("before a move, no checkpoint when no task waits or the task already resumes from the notes", async () => {
    const none = setup();
    await none.manager.checkpointBeforeMove();
    expect(none.turns).toHaveLength(0);
    const resumed = setup();
    await resumed.manager.start("manifest");
    await resumed.manager.resumeFromNotes();
    await resumed.manager.checkpointBeforeMove();
    expect(resumed.turns).toHaveLength(1);
  });

  it("a failed or cancelled checkpoint before a move is logged and the task keeps waiting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let t!: ReturnType<typeof setup>;
    t = setup({
      script: [[ok], [cancelled]],
      during: (i) => {
        if (i === 1) t.manager.cancel();
      },
    });
    await t.manager.start("manifest");
    await t.manager.checkpointBeforeMove();
    expect(t.state().current?.status).toBe("waiting");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("closes a moved task without a closing turn: its new session holds no conversation", async () => {
    const t = setup({ path: ["manifest", "engines"] });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await pick(t, { label: "Next", next: true });
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "run"]);
    expect(t.state()).toMatchObject({ actions: { manifest: "unfinished" }, current: { action: "engines", status: "waiting" } });
  });

  it("does nothing on resumeFromNotes when no task is open", async () => {
    const t = setup();
    await t.manager.resumeFromNotes();
    expect(t.state().current).toBeNull();
  });

  it("tags the note's history commit with its task and action", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await pick(t, { label: "Done", next: true });
    expect(t.log).toContain("history:Note: The manifest");
    expect(t.trailers).toEqual([{ task: "t1", action: "manifest" }]);
  });

  it("tags a free question's note with its task only", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]] });
    await t.manager.ask("Where are chats saved?");
    await t.manager.finish();
    expect(t.trailers).toEqual([{ task: "t1" }]);
  });

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

  it("finish closes the open task with its quiet turn and starts nothing after it", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]] });
    await t.manager.start("manifest");
    expect(await t.manager.finish()).toBe(true);
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "close"]);
    expect(t.turns[1]).toMatchObject({ message: CLOSE_PROMPT, options: { task: "t1", quiet: true } });
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "done" } });
    expect(t.log.slice(-3)).toEqual(["note:manifest", "history:Note: The manifest", "endSession"]);
  });

  it("finish with no open task runs nothing", async () => {
    const t = setup();
    expect(await t.manager.finish()).toBe(true);
    expect(t.turns).toHaveLength(0);
    expect(t.state().current).toBeNull();
  });

  it("finish answers false when it was stopped before the closing turn: the task stays open", async () => {
    const t = setup({ script: [[ok]] });
    await t.manager.start("manifest");
    const finishing = t.manager.finish();
    t.manager.cancel();
    expect(await finishing).toBe(false);
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ action: "manifest", status: "waiting" });
  });

  it("finish answers true when the closing turn itself is cancelled: the task ends unfinished, with no note", async () => {
    const t = setup({ script: [[ok], [cancelled]] });
    await t.manager.start("manifest");
    expect(await t.manager.finish()).toBe(true);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
    expect(t.log.filter((l) => l.startsWith("note:"))).toEqual([]);
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

  it("fits a resumed task's stored effort to what the engine offers now, so a stale one never reaches the engine", async () => {
    const stale: ModelProfile = { ...deep, effort: "max" };
    const state: TasksFile = { ...emptyTasks(), current: { id: "t9", action: "manifest", status: "waiting", startedAt: "t", turns: 1, profile: stale } };
    const t = setup({ state, fit: (p) => (p.effort === "max" ? { ...p, effort: "high" } : p) });
    await t.manager.ask("More?");
    expect(t.turns[0].options.profile).toEqual(deep);
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

describe("TaskManager context and checkpoints", () => {
  const standard: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };
  const ctx = (used: number): Event => ({ type: "context", used });

  it("tracks the context in use and shows it against the cap", async () => {
    const t = setup({ profile: standard, script: [[ctx(50_000), ok]] });
    await t.manager.start("manifest");
    expect(t.state().current?.context).toEqual({ used: 50_000 });
    expect(t.views.at(-1)?.current?.context).toEqual({ used: 50_000, cap: 200_000 });
  });

  it("at 80% of the cap, runs one quiet checkpoint turn before the next follow-up, then not again", async () => {
    const t = setup({ profile: standard, script: [[ctx(170_000), ok], [saveNote(), ok], [ctx(175_000), ok], [ctx(180_000), ok]] });
    await t.manager.start("manifest");
    await t.manager.ask("And the blocks?");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "run"]);
    expect(t.turns[1]).toMatchObject({ message: CHECKPOINT_PROMPT, options: { quiet: true, action: "manifest", task: "t1", profile: standard } });
    expect(t.turns[2]).toMatchObject({ message: "And the blocks?", options: { followUp: true } });
    expect(t.log).toContain("note:manifest");
    expect(t.state().current).toMatchObject({ status: "waiting", checkpointed: true, checkpointNote: true });
    expect(t.state().current?.noteSaved).toBeUndefined();
    await t.manager.ask("And history?");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "run", "run"]);
  });

  it("shows the checkpoint status while it runs", async () => {
    const statuses: (string | undefined)[] = [];
    const t = setup({ profile: standard, script: [[ctx(170_000), ok]], onSave: (s) => statuses.push(s.current?.status) });
    await t.manager.start("manifest");
    await t.manager.ask("More?");
    expect(statuses).toContain("checkpoint");
    expect(statuses.at(-1)).toBe("waiting");
  });

  it("a reported compaction, or the context falling by more than half, allows the next checkpoint and is logged", async () => {
    const compacted: string[] = [];
    const t = setup({
      profile: standard,
      script: [[ctx(170_000), ok], [ok], [{ type: "compaction" }, ctx(30_000), ok], [ctx(165_000), ok], [ok], [ctx(60_000), ok]],
      recordCompaction: (task) => void compacted.push(task.id),
    });
    await t.manager.start("manifest");
    await t.manager.ask("one");
    await t.manager.ask("two");
    await t.manager.ask("three");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "run", "run", "checkpoint", "run"]);
    expect(compacted).toEqual(["t1", "t1"]);
    expect(t.state().current?.context).toEqual({ used: 60_000 });
  });

  it("a checkpoint note doesn't skip the closing turn, and the topic ends done even if closing brings none", async () => {
    const t = setup({ profile: standard, script: [[ctx(170_000), ok], [saveNote(), ok], [ok], [ok]] });
    await t.manager.start("manifest");
    await t.manager.ask("More?");
    await pick(t, { label: "Next", next: true });
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "run", "close", "run"]);
    expect(t.state().actions.manifest).toBe("done");
  });

  it("cancel during the checkpoint: no follow-up turn, the task waits again, the window told", async () => {
    let t!: ReturnType<typeof setup>;
    t = setup({
      profile: standard,
      script: [[ctx(170_000), ok], [cancelled]],
      during: (i) => {
        if (i === 1) t.manager.cancel();
      },
    });
    await t.manager.start("manifest");
    await t.manager.ask("More?");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint"]);
    expect(t.state().current?.status).toBe("waiting");
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
  });

  it("a cancelled checkpoint runs again before the next follow-up", async () => {
    let t!: ReturnType<typeof setup>;
    t = setup({
      profile: standard,
      script: [[ctx(170_000), ok], [cancelled], [saveNote(), ok], [ok]],
      during: (i) => {
        if (i === 1) t.manager.cancel();
      },
    });
    await t.manager.start("manifest");
    await t.manager.ask("More?");
    expect(t.state().current?.checkpointed).toBe(false);
    await t.manager.ask("More?");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "checkpoint", "checkpoint", "run"]);
    expect(t.state().current).toMatchObject({ status: "waiting", checkpointed: true, checkpointNote: true });
  });

  it("never checkpoints a task without a profile", async () => {
    const t = setup({ script: [[ctx(900_000), ok]] });
    await t.manager.start("manifest");
    await t.manager.ask("More?");
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "run"]);
  });
});

/**
 * Real turns: a TurnController over a runtime that plays the next script entry per turn (`done: ok` when
 * none is left). `during(i)` runs inside turn i before its events; a cancel ends the turn as cancelled.
 */
function realTurns(script: Event[][], during?: (index: number) => void) {
  const window: Event[] = [];
  const messages: string[] = [];
  const runtime = {
    send: (message: string, emit: (e: Event) => void) => {
      const index = messages.push(message) - 1;
      let ended = false;
      const play = (events: Event[]) => {
        for (const e of events) {
          if (ended) return;
          if (e.type === "done") ended = true;
          emit(e);
        }
      };
      const done = (async () => {
        await Promise.resolve();
        during?.(index);
        play(script[index] ?? [ok]);
      })();
      return { cancel: () => play([cancelled]), done };
    },
  } as unknown as HarnessRuntime;
  const controller = new TurnController({
    ensureRuntime: async () => runtime,
    chatLog: async () => ({ append: async () => {} }),
    stateBlocks: () => new Set(),
    emit: (e) => void window.push(e),
  });
  return { controller, window, messages };
}

describe("TaskManager over real turns: what the window sees", () => {
  const standard: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };
  const deep: ModelProfile = { engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000 };
  const ctx = (used: number): Event => ({ type: "context", used });
  const unavailable: Event = { type: "done", ok: false, error: { code: "model-unavailable" } };
  const answer: Event = { type: "text", delta: "Answer" };

  it("checkpoint fails (not cancelled): the window gets only the follow-up's text and its one done", async () => {
    const r = realTurns([[ctx(170_000), ok], [crashed], [answer, ok]]);
    const t = setup({ profile: standard, turns: r.controller, window: r.window });
    await t.manager.start("manifest");
    r.window.length = 0;
    await t.manager.ask("More?");
    expect(r.messages).toHaveLength(3);
    expect(r.window).toEqual([answer, ok]);
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 2 });
  });

  it("quit during a checkpoint: no follow-up, no next task, the window told the turn stopped", async () => {
    let t!: ReturnType<typeof setup>;
    const r = realTurns([[ctx(170_000), ok]], (i) => {
      if (i !== 1) return;
      t.manager.close();
      r.controller.close();
    });
    t = setup({ profile: standard, turns: r.controller, window: r.window });
    await t.manager.start("manifest");
    r.window.length = 0;
    await t.manager.ask("More?");
    expect(r.messages).toHaveLength(2);
    expect(r.window).toEqual([cancelled]);
    expect(t.state().current).toMatchObject({ status: "waiting", checkpointed: false });
    await expect(t.manager.ask("Again?")).rejects.toThrow("The app is closing");
  });

  it("quit during a fallback retry: no further turn, no task left, one cancelled done in the window", async () => {
    let t!: ReturnType<typeof setup>;
    const r = realTurns([[unavailable]], (i) => {
      if (i !== 1) return;
      t.manager.close();
      r.controller.close();
    });
    t = setup({ profile: deep, fallback: (p) => (p.model === "opus" ? standard : null), turns: r.controller, window: r.window });
    await t.manager.start("manifest");
    expect(r.messages).toHaveLength(2);
    expect(r.window).toEqual([cancelled]);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
  });

  it("quit while the failed attempt's session ends: no retry, one cancelled done in the window", async () => {
    let t!: ReturnType<typeof setup>;
    let ends = 0;
    const r = realTurns([[unavailable]]);
    t = setup({
      profile: deep,
      fallback: (p) => (p.model === "opus" ? standard : null),
      turns: r.controller,
      window: r.window,
      onEndSession: () => {
        if (++ends !== 2) return;
        t.manager.close();
        r.controller.close();
      },
    });
    await t.manager.start("manifest");
    expect(r.messages).toHaveLength(1);
    expect(r.window).toEqual([cancelled]);
    expect(t.state()).toMatchObject({ current: null, actions: { manifest: "unfinished" } });
  });
});

describe("TaskManager: between tasks (harness-settings D4)", () => {
  const sessions = (log: string[]) => log.filter((l) => l === "endSession" || l === "between" || l.startsWith("turn:"));

  it("runs betweenTasks after a task ends and before the next task's first turn", async () => {
    const t = setup({ betweenTasks: () => {} });
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(sessions(t.log)).toEqual(["endSession", "between", "turn:run", "turn:close", "endSession", "between", "endSession", "between", "turn:run"]);
  });

  it("runs it when the open task is interrupted, and when a first turn fails", async () => {
    const t = setup({ betweenTasks: () => {} });
    await t.manager.start("manifest");
    await t.manager.interrupt();
    expect(t.log.at(-1)).toBe("between");
    const u = setup({ betweenTasks: () => {}, script: [[crashed]] });
    await u.manager.start("manifest");
    expect(u.state().current).toBeNull();
    expect(u.log.at(-1)).toBe("between");
  });

  it("a failing betweenTasks is logged and never stops the task", async () => {
    const t = setup({
      betweenTasks: () => {
        throw new Error("disk full");
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.manager.start("manifest");
    expect(t.state().current).toMatchObject({ status: "waiting" });
    expect(errors).toHaveBeenCalledWith("Could not prepare the next session", expect.any(Error));
    errors.mockRestore();
  });

  it("whenNoTask runs after the running operation, and only when no task is open then", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ gate });
    const order: string[] = [];
    const started = t.manager.start("manifest").then(() => void order.push("started"));
    const ran = t.manager.whenNoTask(async () => void order.push("fn"));
    release();
    expect(await ran).toBe(false);
    await started;
    expect(order).toEqual(["started"]);

    await t.manager.interrupt();
    expect(await t.manager.whenNoTask(async () => void order.push("fn"))).toBe(true);
    expect(order).toEqual(["started", "fn"]);
  });

  it("D0: without betweenTasks nothing new runs", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.log).not.toContain("between");
  });
});
