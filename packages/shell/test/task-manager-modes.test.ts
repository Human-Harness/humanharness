import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { SavedNote, Tier } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { ModeChoice, TaskView } from "@humanharness/protocol";
import type { Note, NoteMeta } from "@humanharness/workspace";
import { TaskManager, type TurnEnd } from "../src/main/task-manager";
import { CLOSE_PROMPT, closePrompt, modePrompt, modeSection, recommendSection, resumeMessage } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };
const NOW = "2026-10-26T10:00:00.000Z";
const NOTE: SavedNote = { title: "Halves", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const MODES = {
  socratic: { label: "Socratic", recommend: "One key idea to discover." },
  feynman: { label: "Feynman" },
  worked: { label: "Worked examples", minTier: "deep" as const },
};
const profileOf = (tier: Tier): ModelProfile => ({ engine: "claude", tier, model: tier === "deep" ? "opus" : tier === "light" ? "haiku" : "sonnet", effort: "medium", cap: 200_000 });
const brief = (mode: string) => `Brief of ${mode}, in {{language}}.`;

/** A task manager over memory, for a harness whose `study` action has three modes and whose `quiz` has none. */
export function setup(
  opts: { script?: Event[][]; state?: TasksFile; modes?: false; defaultMode?: string; notes?: Note[]; gate?: Promise<void>; gateTurn?: number; failSend?: number; labels?: Record<string, string>; badBrief?: string; ended?: TurnEnd[] } = {},
) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const written: { slug: string; note: SavedNote; meta: NoteMeta }[] = [];
  const floors: (Tier | undefined)[] = [];
  const emitted: Event[] = [];
  let busy = false;
  let gate = opts.gate;
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
      cancel: () => {},
      send: async (message, options) => {
        // `failSend`: that turn (0-based) can't start.
        if (turns.length === opts.failSend) {
          turns.push({ message, options });
          throw new Error("The app is closing");
        }
        busy = true;
        turns.push({ message, options });
        // `gate` holds the first turn, or turn `gateTurn` (0-based).
        const g = turns.length - 1 === (opts.gateTurn ?? 0) ? gate : undefined;
        if (g) gate = undefined;
        await g;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: {
      study: { label: "Study", modes: ["socratic", "feynman", "worked"], ...(opts.defaultMode ? { defaultMode: opts.defaultMode } : {}) },
      quiz: { label: "Quiz" },
    },
    path: ["study", "quiz"],
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => opts.notes ?? [],
    writeNote: async (slug, note, meta) => void written.push({ slug, note, meta }),
    endSession: async () => {},
    changed: (v) => views.push(v),
    emit: (e) => void emitted.push(e),
    profileFor: async (_action, floor) => {
      floors.push(floor);
      return profileOf(floor ?? "standard");
    },
    ...(opts.modes === false
      ? {}
      : {
          modes: Object.fromEntries(Object.entries(MODES).map(([id, m]) => [id, opts.labels?.[id] ? { ...m, label: opts.labels[id] } : m])),
          readModeBrief: async (mode: string) => {
            if (mode === opts.badBrief) throw new Error(`ENOENT: modes/${mode}.md`);
            return brief(mode);
          },
          modeSettings: async (mode: string) => (mode === "socratic" ? ["Ask many questions before explaining."] : []),
          tierOf: async (p: ModelProfile) => (p.tier === "custom" ? "standard" : p.tier),
        }),
    now: () => new Date(NOW),
    newId: () => `t${++n}`,
    ...(opts.ended ? { turnEnded: (e: TurnEnd) => void opts.ended?.push(e) } : {}),
  });
  return { manager, turns, views, written, floors, emitted, state: () => state };
}

const socratic = { label: "Socratic", brief: brief("socratic"), settings: ["Ask many questions before explaining."] };

describe("TaskManager: how a task starts (task-modes spec §3 defaultMode, §4)", () => {
  it("D0: an action without modes, or a harness without them, starts exactly as before", async () => {
    const t = setup();
    await t.manager.start("quiz");
    expect(t.turns[0].message).toBe("# Task: quiz");
    expect(t.turns[0].options).not.toHaveProperty("mode");
    for (const key of ["mode", "modes", "belowMinTier"]) expect(t.state().current).not.toHaveProperty(key);
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "quiz", status: "waiting" });
    const plain = setup({ modes: false });
    await plain.manager.start("study");
    expect(plain.turns[0].message).toBe("# Task: study");
    expect(plain.views.at(-1)?.current).toEqual({ id: "t1", action: "study", status: "waiting" });
    expect(t.floors).toEqual([undefined]);
    expect(plain.floors).toEqual([undefined]);
  });

  it("a label with a newline stays on one line: a single `## Mode:` heading", async () => {
    const t = setup({ defaultMode: "socratic", labels: { socratic: "Socratic\n  questions" } });
    await t.manager.start("study");
    expect(t.turns[0].message).toContain("## Mode: Socratic questions\n\nWork in this mode.");
    expect(t.turns[0].message.match(/^## Mode:/gm)).toHaveLength(1);
  });

  it("a mode brief that can't be read refuses the start before the open task closes", async () => {
    const t = setup({ badBrief: "feynman" });
    await t.manager.start("quiz");
    await expect(t.manager.start("study", undefined, undefined, "feynman")).rejects.toThrow("ENOENT");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ id: "t1", action: "quiz", status: "waiting" });
  });

  it("recommend (the default): the first message lists the action's modes with their hints, that message only", async () => {
    const t = setup();
    await t.manager.start("study");
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toBe(
      `# Task: study\n\n${recommendSection([
        { id: "socratic", label: "Socratic", recommend: "One key idea to discover." },
        { id: "feynman", label: "Feynman" },
        { id: "worked", label: "Worked examples" },
      ])}`,
    );
    expect(t.turns[1].message).toBe("Go on");
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "study", status: "waiting", tier: "standard" });
  });

  it("a mode id as defaultMode: its section after the action's brief; the task and its turns carry the mode", async () => {
    const t = setup({ defaultMode: "socratic" });
    await t.manager.start("study");
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toBe(`# Task: study\n\n${modeSection(socratic, "en")}`);
    expect(t.turns[0].message).toContain("Brief of socratic, in English.");
    expect(t.turns[0].options.mode).toBe("socratic");
    expect(t.turns[1].options.mode).toBe("socratic");
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic"] });
    expect(t.views.at(-1)?.current).toMatchObject({ mode: "socratic", modes: ["socratic"], tier: "standard" });
  });

  it("an explicit mode wins; 'ask' with none picked falls back to a recommendation; an unknown one is refused before anything closes", async () => {
    const t = setup({ defaultMode: "ask" });
    await t.manager.start("study");
    expect(t.turns[0].message).toContain("## How to work");
    await t.manager.start("study", undefined, undefined, "feynman");
    expect(t.turns.at(-1)!.message).toBe(`# Task: study\n\n${modeSection({ label: "Feynman", brief: brief("feynman"), settings: [] }, "en")}`);
    const before = t.turns.length;
    await expect(t.manager.start("study", undefined, undefined, "nope")).rejects.toThrow("Unknown mode");
    await expect(t.manager.start("quiz", undefined, undefined, "socratic")).rejects.toThrow("Unknown mode");
    expect(t.turns).toHaveLength(before);
    expect(t.state().current?.mode).toBe("feynman");
  });

  it("a task that starts in a mode above its tier starts anyway, marked below", async () => {
    const t = setup({ defaultMode: "worked" });
    await t.manager.start("study");
    expect(t.state().current).toMatchObject({ mode: "worked", belowMinTier: true });
    expect(t.views.at(-1)?.current).toMatchObject({ mode: "worked", tier: "standard", belowMinTier: true });
  });

  it("the closing turn lists the modes used and the note keeps their ids; D0: CLOSE_PROMPT and no modes", async () => {
    const t = setup({ defaultMode: "socratic", script: [[ok], [saveNote, ok], [ok], [saveNote, ok]] });
    await t.manager.start("study");
    await t.manager.finish();
    expect(t.turns[1].message).toBe(closePrompt(["Socratic"]));
    expect(t.turns[1].options).toMatchObject({ phase: "close", mode: "socratic" });
    expect(t.written[0].meta).toEqual({ action: "study", date: NOW, engine: "claude", modes: ["socratic"] });
    await t.manager.start("quiz");
    await t.manager.finish();
    expect(t.turns[3].message).toBe(CLOSE_PROMPT);
    expect(t.written[1].meta).toEqual({ action: "quiz", date: NOW, engine: "claude" });
  });

  it("a resumed session comes back in the same mode", async () => {
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 2, mode: "feynman", modes: ["feynman"], resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current } });
    await t.manager.ask("Hi");
    const section = modeSection({ label: "Feynman", brief: brief("feynman"), settings: [] }, "en");
    expect(t.turns[0].message).toBe(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: study\n\n{{notesIndex}}", mode: section, message: "Hi" }));
    expect(t.turns[0].options.mode).toBe("feynman");
  });

  it("a resumed session whose mode brief can't be read resumes without the mode's section (logged)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 2, mode: "feynman", modes: ["feynman"], resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current }, badBrief: "feynman" });
    await t.manager.ask("Hi");
    expect(t.turns[0].message).toBe(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: study\n\n{{notesIndex}}", message: "Hi" }));
    expect(error).toHaveBeenCalledWith("Could not read the mode's brief; the task resumes without it", expect.any(Error));
    error.mockRestore();
  });
});

const pick = async (t: ReturnType<typeof setup>, mode: string, choice?: ModeChoice) => {
  const { accepted, done } = t.manager.chooseMode(mode, choice);
  const r = await accepted;
  await done;
  return r;
};

describe("TaskManager.chooseMode (task-modes spec §5)", () => {
  it("a switch's turn tells Sidekick it was a mode switch (no after-reply on it)", async () => {
    const ended: TurnEnd[] = [];
    const t = setup({ ended });
    await t.manager.start("study");
    await pick(t, "socratic");
    expect(ended.map((e) => [e.kind, e.prompt, e.modeSwitch])).toEqual([
      ["run", "Study", false],
      ["run", "Switched to Socratic", true],
    ]);
  });

  it("switches in one turn of the same session: the mode's brief and settings, a system line, then the state", async () => {
    const t = setup();
    await t.manager.start("study");
    expect(await pick(t, "socratic")).toEqual({ ok: true, switched: "turn" });
    expect(t.turns[1].message).toBe(modePrompt(socratic, { language: "en" }));
    expect(t.turns[1].options).toMatchObject({ display: "Switched to Socratic", modeSwitch: true, mode: "socratic", action: "study", followUp: true });
    expect(t.turns[1].options).not.toHaveProperty("quiet");
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic"], status: "waiting", turns: 2 });
    await pick(t, "feynman");
    await pick(t, "socratic");
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic", "feynman"] });
  });

  it("refuses with no waiting task, a mode the action doesn't list, and does nothing for the current mode", async () => {
    const t = setup();
    expect(await pick(t, "socratic")).toEqual({ ok: false, reason: "no-task" });
    await t.manager.start("quiz");
    expect(await pick(t, "socratic")).toEqual({ ok: false, reason: "unknown" });
    await t.manager.start("study");
    expect(await pick(t, "nope")).toEqual({ ok: false, reason: "unknown" });
    await pick(t, "socratic");
    const before = t.turns.length;
    expect(await pick(t, "socratic")).toEqual({ ok: true, switched: "same" });
    expect(t.turns).toHaveLength(before);
  });

  it("a failed switch turn leaves the mode as it was, so it can be picked again", async () => {
    const t = setup({ script: [[ok], [{ type: "done", ok: false, error: { code: "agent-crashed" } }]] });
    await t.manager.start("study");
    expect(await pick(t, "feynman")).toEqual({ ok: true, switched: "turn" });
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.state().current?.status).toBe("waiting");
  });

  it("a switch turn that can't start after the switch was taken ends the window's turn with an error", async () => {
    const t = setup({ failSend: 1 });
    await t.manager.start("study");
    const { accepted, done } = t.manager.chooseMode("feynman");
    expect(await accepted).toEqual({ ok: true, switched: "turn" });
    await expect(done).rejects.toThrow("The app is closing");
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: "The app is closing" } }]);
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.state().current?.status).toBe("waiting");
  });

  it("'new-task' whose new task can't start ends the window's turn with an error too", async () => {
    const t = setup({ defaultMode: "socratic", script: [[ok], [saveNote, ok]], failSend: 2 });
    await t.manager.start("study");
    const { accepted, done } = t.manager.chooseMode("worked", { belowTier: "new-task" });
    expect(await accepted).toEqual({ ok: true, switched: "new-task" });
    await expect(done).rejects.toThrow("The app is closing");
    expect(t.emitted.filter((e) => e.type === "done")).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: "The app is closing" } }]);
  });

  it("below the mode's minTier: refused with the tiers; 'continue' switches and marks it; a fitting mode clears the mark", async () => {
    const t = setup();
    await t.manager.start("study");
    expect(await pick(t, "worked")).toEqual({ ok: false, reason: "tier", required: "deep", current: "standard" });
    expect(t.turns).toHaveLength(1);
    expect(await pick(t, "worked", { belowTier: "continue" })).toEqual({ ok: true, switched: "turn" });
    expect(t.state().current).toMatchObject({ mode: "worked", belowMinTier: true });
    await pick(t, "feynman");
    expect(t.state().current).not.toHaveProperty("belowMinTier");
  });

  it("'new-task' closes the task (its note) and starts the same action in that mode at the mode's tier", async () => {
    const t = setup({ defaultMode: "socratic", script: [[ok], [saveNote, ok], [ok]] });
    await t.manager.start("study");
    expect(await pick(t, "worked", { belowTier: "new-task" })).toEqual({ ok: true, switched: "new-task" });
    expect(t.turns[1].message).toBe(closePrompt(["Socratic"]));
    expect(t.turns[2].message).toContain("## Mode: Worked examples");
    expect(t.floors.at(-1)).toBe("deep");
    expect(t.state().actions.study).toBe("done");
    expect(t.state().current).toMatchObject({ id: "t2", action: "study", mode: "worked", modes: ["worked"], profile: { tier: "deep" } });
    expect(t.state().current).not.toHaveProperty("belowMinTier");
  });

  it("waits for a running turn to end, never cancelling it (spec §5.2)", async () => {
    let release!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (release = r)) });
    const started = t.manager.start("study");
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    const { accepted, done } = t.manager.chooseMode("feynman");
    await new Promise((r) => setTimeout(r, 30));
    expect(t.turns).toHaveLength(1);
    release();
    await started;
    expect(await accepted).toEqual({ ok: true, switched: "turn" });
    await done;
    expect(t.turns[1].options.mode).toBe("feynman");
  });

  it("a pick queued behind a turn is refused when that task ended and another started meanwhile", async () => {
    let release!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (release = r)), gateTurn: 1, script: [[ok], [saveNote, ok], [ok]] });
    await t.manager.start("study");
    // The closing turn of t1 runs (the person started the action again); the pick, made while t1 was shown, waits.
    const next = t.manager.start("study");
    await vi.waitFor(() => expect(t.turns).toHaveLength(2));
    const { accepted, done } = t.manager.chooseMode("feynman", {}, "t1");
    release();
    await next;
    expect(await accepted).toEqual({ ok: false, reason: "no-task" });
    await done;
    expect(t.turns).toHaveLength(3);
    expect(t.state().current?.id).toBe("t2");
    expect(t.state().current).not.toHaveProperty("mode");
  });

  it("two picks during one turn both wait and run in order", async () => {
    let release!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (release = r)) });
    const started = t.manager.start("study");
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    const first = t.manager.chooseMode("feynman");
    const second = t.manager.chooseMode("socratic");
    release();
    await started;
    expect(await first.accepted).toEqual({ ok: true, switched: "turn" });
    expect(await second.accepted).toEqual({ ok: true, switched: "turn" });
    await Promise.all([first.done, second.done]);
    expect(t.turns.map((x) => x.options.mode)).toEqual([undefined, "feynman", "socratic"]);
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["feynman", "socratic"] });
  });

  it("'new-task' with a mode brief that can't be read is refused before the task closes", async () => {
    const t = setup({ badBrief: "worked" });
    await t.manager.start("study");
    const { accepted, done } = t.manager.chooseMode("worked", { belowTier: "new-task" });
    await expect(accepted).rejects.toThrow("ENOENT");
    await expect(done).rejects.toThrow("ENOENT");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting" });
    expect(t.emitted).toEqual([]);
  });

  it("a task whose session was lost switches quietly; its resumed session carries the mode", async () => {
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 1, resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current } });
    expect(await pick(t, "feynman")).toEqual({ ok: true, switched: "quiet" });
    expect(t.turns).toHaveLength(0);
    expect(t.state().current).toMatchObject({ mode: "feynman", modes: ["feynman"], resume: true });
  });

  it("carries the last checkpoint's summary when the task has one (spec §10.1)", async () => {
    const note: Note = { slug: "study", action: "study", date: NOW, engine: "claude", ...NOTE, path: ".harness/notes/study.md" };
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 3, checkpointNote: true, checkpointTurns: 3, profile: profileOf("standard") };
    const t = setup({ notes: [note], state: { version: 1, actions: {}, current } });
    await pick(t, "feynman");
    expect(t.turns[0].message).toContain("What is clear so far (the last checkpoint): Two halves make a whole.");
  });

  it("a checkpoint taken in the switch carries the summary it just saved", async () => {
    const note: Note = { slug: "study", action: "study", date: NOW, engine: "claude", ...NOTE, path: ".harness/notes/study.md" };
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 3, profile: profileOf("standard"), context: { used: 190_000 } };
    const t = setup({ notes: [note], state: { version: 1, actions: {}, current }, script: [[saveNote, ok], [ok]] });
    expect(await pick(t, "feynman")).toEqual({ ok: true, switched: "turn" });
    expect(t.turns[0].options).toMatchObject({ phase: "checkpoint" });
    expect(t.turns[1].message).toContain("What is clear so far (the last checkpoint): Two halves make a whole.");
  });

  it("caps the checkpoint's summary it carries: 5 points of 400 characters at most", async () => {
    const long = Array.from({ length: 7 }, (_, i) => `${i}${"x".repeat(500)}`);
    const note: Note = { slug: "study", action: "study", date: NOW, engine: "claude", ...NOTE, summary: long, path: ".harness/notes/study.md" };
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 3, checkpointNote: true, checkpointTurns: 3, profile: profileOf("standard") };
    const t = setup({ notes: [note], state: { version: 1, actions: {}, current } });
    await pick(t, "feynman");
    const feynman = { label: "Feynman", brief: brief("feynman"), settings: [] };
    expect(t.turns[0].message).toBe(modePrompt(feynman, { language: "en", soFar: long.slice(0, 5).map((s) => s.slice(0, 400)) }));
  });
});
