import { describe, expect, it } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import { type HarnessPhase, type HarnessTimeBox, type InputBlock, type SavedNote, defineBlock, z } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskTurnNotice, TaskView } from "@humanharness/ui/client";
import type { NoteMeta } from "@humanharness/workspace";
import { type TaskDeps, TaskManager } from "../src/main/task-manager";
import { CHECKPOINT_PROMPT, CLOSE_PROMPT, PHASE_BACK, phasePrompt, phaseSection, phasesSection, resumeMessage } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };
const NOW = "2026-10-26T10:00:00.000Z";
const NOTE: SavedNote = { title: "Fractions", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const ask = (to: string, reason = "Done here"): Event => ({ type: "block", name: "set_phase", data: { to, reason } });
const PHASES: HarnessPhase[] = [
  { id: "warmup", label: "Warm-up", brief: "phases/warmup.md", auto: true },
  { id: "main", label: "Main block", brief: "phases/main.md" },
  { id: "close", label: "Close", brief: "phases/close.md", close: true },
];
const LIST = [
  { id: "warmup", label: "Warm-up" },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close" },
];
const brief = (phase: string) => `Brief of ${phase} in {{language}}.`;
const text = (id: string, label: string) => ({ id, label, brief: brief(id) });
const profile: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };

/** A task manager over memory: `session` has phases (and, when asked, modes and a time box); `quiz` has none. */
export function setup(
  opts: { script?: Event[][]; state?: TasksFile; phases?: HarnessPhase[]; modes?: { modes: string[]; defaultMode?: string }; timeBox?: HarnessTimeBox; gate?: Promise<void>; extra?: Partial<TaskDeps> } = {},
) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const notices: TaskTurnNotice[] = [];
  const written: { slug: string; note: SavedNote; meta: NoteMeta }[] = [];
  const emitted: Event[] = [];
  let clock = Date.parse(NOW);
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
        busy = true;
        turns.push({ message, options });
        // `gate` holds the first turn only.
        const g = gate;
        gate = undefined;
        await g;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: {
      session: { label: "Session", phases: opts.phases ?? PHASES, ...(opts.modes ?? {}), ...(opts.timeBox ? { timeBox: opts.timeBox } : {}) },
      quiz: { label: "Quiz" },
    },
    path: ["session", "quiz"],
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    readPhaseBrief: async (_action, phase) => brief(phase),
    taskTurn: (notice) => void notices.push(notice),
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async (slug, note, meta) => void written.push({ slug, note, meta }),
    endSession: async () => {},
    changed: (v) => views.push(v),
    emit: (e) => void emitted.push(e),
    profileFor: async () => profile,
    ...(opts.modes
      ? {
          modes: { socratic: { label: "Socratic" }, feynman: { label: "Feynman" } },
          readModeBrief: async (mode: string) => `Brief of ${mode}.`,
          modeSettings: async () => [],
          tierOf: async () => "standard" as const,
        }
      : {}),
    minuteMs: 1000,
    ...opts.extra,
    now: () => new Date(clock),
    newId: () => `t${++n}`,
  });
  return {
    manager,
    turns,
    views,
    notices,
    written,
    emitted,
    state: () => state,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("TaskManager: phases (task-phases spec §4)", () => {
  it("D0: an action without phases starts and runs exactly as before", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toBe("# Task: quiz");
    for (const turn of t.turns) expect(turn.options).not.toHaveProperty("taskPhase");
    for (const key of ["phase", "phases", "phaseProposal", "timeBox", "suspendedMode"]) expect(t.state().current).not.toHaveProperty(key);
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "quiz", status: "waiting" });
    expect(t.notices).toEqual([]);
    expect(await t.manager.trailerNow()).toEqual({ task: "t1", action: "quiz" });
  });

  it("a task starts in its first phase: the parts listed, the first part's brief, the phase in state, turns and view", async () => {
    const t = setup();
    await t.manager.start("session");
    expect(t.turns[0].message).toBe(`# Task: session\n\n${phasesSection(LIST, "warmup")}\n\n${phaseSection(text("warmup", "Warm-up"), { language: "en" })}`);
    expect(t.turns[0].options).toMatchObject({ taskPhase: "warmup" });
    expect(t.state().current).toMatchObject({ phase: { id: "warmup", startedAt: NOW }, phases: [{ id: "warmup", at: NOW, by: "app" }] });
    expect(t.views.at(-1)?.current).toMatchObject({ phase: "warmup", phases: [{ id: "warmup", at: NOW, by: "app" }] });
    expect(t.notices).toEqual([]);
    // Commits made on the task's behalf carry its phase (history `Phase:` trailer).
    expect(await t.manager.trailerNow()).toEqual({ task: "t1", action: "session", phase: "warmup" });
  });

  it("auto and the next phase: the app moves right after the turn, in the same operation, and tells the window first", async () => {
    const t = setup({ script: [[ask("main", "Recall done"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].message).toBe(phasePrompt(text("main", "Main block"), { language: "en", previous: "Warm-up" }));
    expect(t.turns[1].options).toMatchObject({ phase: "phase-change", phaseChange: "main", taskPhase: "main", display: "— Main block —", followUp: true });
    expect(t.notices).toEqual([{ task: "t1", kind: "phase", phase: "main", by: "agent" }]);
    expect(t.state().current).toMatchObject({
      status: "waiting",
      turns: 2,
      phase: { id: "main" },
      phases: [
        { id: "warmup", by: "app" },
        { id: "main", by: "agent" },
      ],
    });
  });

  it("a skip (or no auto, or going back): a proposal the person confirms or ignores", async () => {
    const t = setup({ script: [[ask("close"), ok]] });
    await t.manager.start("session");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ phase: { id: "warmup" }, phaseProposal: { to: "close", reason: "Done here" } });
    expect(t.views.at(-1)?.current).toMatchObject({ phaseProposal: { to: "close", reason: "Done here" } });
    // Ignored: anything the person sends drops it.
    await t.manager.ask("Wait, one more question");
    expect(t.state().current).not.toHaveProperty("phaseProposal");
  });

  it("an id this action doesn't have, or a request in the closing turn, is ignored", async () => {
    const t = setup({ script: [[ask("dessert"), ok], [ask("main"), saveNote, ok]] });
    await t.manager.start("session");
    expect(t.state().current).not.toHaveProperty("phaseProposal");
    expect(t.state().current?.phase?.id).toBe("warmup");
    await t.manager.finish();
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].message).toBe(CLOSE_PROMPT);
    expect(t.turns[1].options).toMatchObject({ phase: "close", taskPhase: "warmup" });
  });

  it("the person moves: forward, back (said so), the same phase; refusals as data", async () => {
    const t = setup();
    await t.manager.start("session");
    let r = t.manager.setPhase("close", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "turn" });
    await r.done;
    expect(t.notices.at(-1)).toEqual({ task: "t1", kind: "phase", phase: "close", by: "person" });
    r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "turn" });
    await r.done;
    expect(t.turns.at(-1)!.message).toBe(phasePrompt(text("main", "Main block"), { language: "en", previous: "Close", back: true }));
    expect(t.turns.at(-1)!.message).toContain(PHASE_BACK);
    expect(t.notices.at(-1)).toEqual({ task: "t1", kind: "phase", phase: "main", by: "person", back: true });
    const before = t.turns.length;
    // Each pick's operation ends before the next one starts.
    const pick = async (to: string, task: string) => {
      const p = t.manager.setPhase(to, task);
      const accepted = await p.accepted;
      await p.done;
      return accepted;
    };
    expect(await pick("main", "t1")).toEqual({ ok: true, changed: "same" });
    expect(await pick("dessert", "t1")).toEqual({ ok: false, reason: "unknown" });
    expect(await pick("main", "t9")).toEqual({ ok: false, reason: "no-task" });
    expect(t.turns).toHaveLength(before);
  });

  it("a phase pick never waits for a turn: it is refused while one runs", async () => {
    let open!: () => void;
    const t = setup({ gate: new Promise<void>((resolve) => (open = resolve)) });
    const started = t.manager.start("session");
    const r = t.manager.setPhase("main", "t1");
    await expect(r.accepted).rejects.toThrow("A turn is already running");
    await expect(r.done).rejects.toThrow("A turn is already running");
    open();
    await started;
  });

  it("a phase with no brief changes only the state: no turn, no notice", async () => {
    const t = setup({ phases: [PHASES[0], { id: "main", label: "Main block" }] });
    await t.manager.start("session");
    const r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "quiet" });
    await r.done;
    expect(t.turns).toHaveLength(1);
    expect(t.notices).toEqual([]);
    expect(t.state().current).toMatchObject({ status: "waiting", phase: { id: "main" } });
  });

  it("a resumed session tells the agent the parts and the current part", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 2, phase: { id: "main", startedAt: NOW }, resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current } });
    await t.manager.ask("Hi");
    const phase = `${phasesSection(LIST, "main")}\n\n${phaseSection(text("main", "Main block"), { language: "en" })}`;
    expect(t.turns[0].message).toBe(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session\n\n{{notesIndex}}", phase, message: "Hi" }));
    expect(t.turns[0].options).toMatchObject({ taskPhase: "main" });
  });

  const waitingIn = (phase: string, extra: Record<string, unknown> = {}): TasksFile => ({
    ...emptyTasks(),
    current: { id: "t1", action: "session", status: "waiting", startedAt: "", turns: 1, phase: { id: phase, startedAt: NOW }, ...extra } as TasksFile["current"],
  });
  const full = { profile: { ...profile, cap: 1000 }, context: { used: 900 } };

  it("a due checkpoint runs before the change, still in the part the task leaves; then the task moves", async () => {
    const t = setup({ state: waitingIn("warmup", full) });
    const r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "turn" });
    await r.done;
    expect(t.turns.map((x) => x.message)).toEqual([CHECKPOINT_PROMPT, phasePrompt(text("main", "Main block"), { language: "en", previous: "Warm-up" })]);
    expect(t.turns[0].options).toMatchObject({ phase: "checkpoint", taskPhase: "warmup" });
    expect(t.turns[1].options).toMatchObject({ phase: "phase-change", taskPhase: "main" });
    expect(t.state().current).toMatchObject({ status: "waiting", phase: { id: "main" } });
  });

  it("a cancelled checkpoint moves nothing", async () => {
    const t = setup({ state: waitingIn("warmup", full), script: [[{ type: "done", ok: false, error: { code: "cancelled" } }]] });
    const r = t.manager.setPhase("main", "t1");
    await r.accepted;
    await r.done;
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ status: "waiting", phase: { id: "warmup" } });
    expect(t.state().current).not.toHaveProperty("phases");
    expect(t.emitted).toContainEqual({ type: "done", ok: false, error: { code: "cancelled" } });
  });

  it("a task whose session is gone moves quietly; its resumed session carries the new part", async () => {
    const t = setup({ state: waitingIn("warmup", { resume: true }) });
    const r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "quiet" });
    await r.done;
    expect(t.turns).toEqual([]);
    expect(t.notices).toEqual([]);
    expect(t.state().current).toMatchObject({ status: "waiting", resume: true, phase: { id: "main" } });
    await t.manager.ask("Hi");
    expect(t.turns[0].message).toContain(phaseSection(text("main", "Main block"), { language: "en" }));
    expect(t.turns[0].options).toMatchObject({ taskPhase: "main" });
  });

  it("the person's move replaces the agent's pending proposal", async () => {
    const t = setup({ script: [[ask("close"), ok]] });
    await t.manager.start("session");
    expect(t.state().current).toHaveProperty("phaseProposal");
    const r = t.manager.setPhase("main", "t1");
    await r.accepted;
    await r.done;
    expect(t.state().current?.phase?.id).toBe("main");
    expect(t.state().current).not.toHaveProperty("phaseProposal");
    expect(t.views.at(-1)?.current).not.toHaveProperty("phaseProposal");
  });

  it("an answer whose turn went well stays answered when the move it asked for fails", async () => {
    const block = defineBlock({
      description: "Commit.",
      visible: true,
      schema: z.object({ question: z.string() }),
      input: z.object({ why: z.string().min(1) }),
      inputUi: { why: { label: "Why" } },
      example: { question: "q" },
    }) as InputBlock;
    const t = setup({
      state: waitingIn("warmup", { pendingInput: { blockId: "t1:0:0", block: "commit_answer", shownAt: NOW } }),
      script: [[ask("main"), ok], [{ type: "done", ok: false, error: { code: "agent-crashed" } }]],
      extra: { inputBlocks: { commit_answer: block }, markAnswered: async () => true },
    });
    const r = t.manager.respond("t1:0:0", { why: "x" });
    expect(await r.accepted).toMatchObject({ ok: true });
    await r.done;
    expect(t.turns).toHaveLength(2);
    expect(t.state().current?.phase?.id).toBe("main");
    expect(t.state().current).not.toHaveProperty("pendingInput");
  });
});
