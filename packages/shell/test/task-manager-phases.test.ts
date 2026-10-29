import { describe, expect, it, vi } from "vitest";
import { type HarnessPhase, type HarnessTimeBox, type InputBlock, type SavedNote, defineBlock, z } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskDeps } from "../src/main/task-manager";
import { CHECKPOINT_PROMPT, CLOSE_PROMPT, PHASE_BACK, modeSection, phasePrompt, phaseSection, phasesSection, recommendSection, resumeMessage, wrapUpPrompt } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import { NOW, PHASES, brief, ok, profile, setup } from "./task-manager-fixture";

const NOTE: SavedNote = { title: "Fractions", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const ask = (to: string, reason = "Done here"): Event => ({ type: "block", name: "set_phase", data: { to, reason } });
const LIST = [
  { id: "warmup", label: "Warm-up" },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close" },
];
const text = (id: string, label: string) => ({ id, label, brief: brief(id) });

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

  it("openPhase: the open task's phase id; undefined without a task", async () => {
    const t = setup();
    expect(await t.manager.openPhase()).toBeUndefined();
    await t.manager.start("session");
    expect(await t.manager.openPhase()).toBe("warmup");
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

describe("TaskManager: modes by phase (task-modes spec §7)", () => {
  const modes = { modes: ["socratic", "feynman"], defaultMode: "socratic" };
  const phases: HarnessPhase[] = [
    { id: "warmup", label: "Warm-up", brief: "w.md", auto: true, modes: "none" },
    { id: "main", label: "Main block", brief: "m.md" },
    { id: "close", label: "Close", brief: "c.md", close: true, modes: "none" },
  ];
  const socratic = modeSection({ label: "Socratic", brief: "Brief of socratic.", settings: [] }, "en");

  it("a default mode the first phase forbids starts suspended and comes back with the first phase that allows it", async () => {
    const t = setup({ modes, phases, script: [[ask("main"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.turns[0].message).not.toContain("## Mode:");
    expect(t.turns[0].options).not.toHaveProperty("mode");
    expect(t.turns[1].message).toBe(phasePrompt(text("main", "Main block"), { language: "en", previous: "Warm-up", extra: [socratic] }));
    expect(t.turns[1].options).toMatchObject({ mode: "socratic" });
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic"] });
    expect(t.state().current).not.toHaveProperty("suspendedMode");
  });

  it("a phase that forbids the mode suspends it; going back restores it; chooseMode refuses a forbidden one", async () => {
    const t = setup({ modes, phases: phases.slice(1) });
    await t.manager.start("session");
    expect(t.state().current).toMatchObject({ mode: "socratic", phase: { id: "main" } });
    await t.manager.setPhase("close", "t1").done;
    expect(t.state().current).toMatchObject({ suspendedMode: "socratic", modes: ["socratic"] });
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.turns.at(-1)!.options).not.toHaveProperty("mode");
    const pick = t.manager.chooseMode("feynman");
    expect(await pick.accepted).toEqual({ ok: false, reason: "phase" });
    await pick.done;
    await t.manager.setPhase("main", "t1").done;
    expect(t.turns.at(-1)!.message).toContain(socratic);
    expect(t.state().current).toMatchObject({ mode: "socratic" });
    expect(t.state().current).not.toHaveProperty("suspendedMode");
  });

  it("recommend waits for the first phase that allows modes, and lists only those", async () => {
    const t = setup({ modes: { modes: ["socratic", "feynman"] }, phases: [phases[0], { ...phases[1], modes: ["feynman"] }, phases[2]], script: [[ask("main"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.turns[0].message).not.toContain("## How to work");
    expect(t.turns[1].message).toContain(recommendSection([{ id: "feynman", label: "Feynman" }]));
    expect(t.state().current).not.toHaveProperty("mode");
  });

  it("a task whose session is gone suspends and restores its mode quietly", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 1, phase: { id: "main", startedAt: NOW }, mode: "socratic", modes: ["socratic"], resume: true as const };
    const t = setup({ modes, phases, state: { ...emptyTasks(), current } });
    await t.manager.setPhase("close", "t1").done;
    expect(t.state().current).toMatchObject({ phase: { id: "close" }, suspendedMode: "socratic" });
    expect(t.state().current).not.toHaveProperty("mode");
    await t.manager.setPhase("main", "t1").done;
    expect(t.turns).toEqual([]);
    expect(t.state().current).toMatchObject({ phase: { id: "main" }, mode: "socratic" });
  });

  it("the recommendation comes once: not again when the task moves to another phase that allows modes", async () => {
    const t = setup({ modes: { modes: ["socratic", "feynman"] }, phases: phases.slice(1).map((p) => ({ ...p, modes: undefined })) });
    await t.manager.start("session");
    expect(t.turns[0].message).toContain("## How to work");
    await t.manager.setPhase("close", "t1").done;
    expect(t.turns.at(-1)!.message).not.toContain("## How to work");
    await t.manager.setPhase("main", "t1").done;
    expect(t.turns.at(-1)!.message).not.toContain("## How to work");
  });

  it("a resumed task moves without reading the mode's brief", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 1, phase: { id: "close", startedAt: NOW }, suspendedMode: "socratic", modes: ["socratic"], resume: true as const };
    const t = setup({ modes, phases, state: { ...emptyTasks(), current }, extra: { readModeBrief: async () => Promise.reject(new Error("unreadable")) } });
    const r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "quiet" });
    await r.done;
    expect(t.state().current).toMatchObject({ phase: { id: "main" }, mode: "socratic" });
  });

  it("a mode restored below the task's tier is marked so", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 1, profile, phase: { id: "close", startedAt: NOW }, suspendedMode: "socratic", modes: ["socratic"] };
    const t = setup({
      modes,
      phases,
      state: { ...emptyTasks(), current },
      extra: { modes: { socratic: { label: "Socratic", minTier: "deep" }, feynman: { label: "Feynman" } } },
    });
    await t.manager.setPhase("main", "t1").done;
    expect(t.state().current).toMatchObject({ mode: "socratic", belowMinTier: true });
    expect(t.turns.at(-1)!.options).toMatchObject({ mode: "socratic" });
  });

  it("an explicit mode the first phase forbids starts suspended too", async () => {
    const t = setup({ modes, phases });
    await t.manager.start("session", undefined, undefined, "feynman");
    expect(t.state().current).toMatchObject({ suspendedMode: "feynman" });
    expect(t.state().current).not.toHaveProperty("mode");
  });
});

describe("TaskManager: the open task keeps its language (language spec §7)", () => {
  it("changing the language with an open task leaves that task in its language", async () => {
    let lang = "es";
    const t = setup({ extra: { language: async () => lang } });
    await t.manager.start("session");
    expect(t.turns[0].message).toContain("Brief of warmup in Spanish.");
    lang = "fr";
    const r = t.manager.setPhase("main", "t1");
    await r.accepted;
    await r.done;
    expect(t.turns.at(-1)!.message).toContain("Brief of main in Spanish.");
    // The next task starts in the new language.
    await t.manager.finish();
    await t.manager.start("quiz");
    expect(t.turns.at(-1)!.message).not.toContain("Spanish");
  });

  it("a mode switch after the setting changed keeps the task's language", async () => {
    let lang = "es";
    const t = setup({
      modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" },
      phases: [{ id: "main", label: "Main block", brief: "m.md" }],
      extra: { language: async () => lang, readModeBrief: async (mode: string) => `Brief of ${mode} in {{language}}.` },
    });
    await t.manager.start("session");
    expect(t.turns[0].message).toContain("Brief of socratic in Spanish.");
    lang = "fr";
    const pick = t.manager.chooseMode("feynman");
    expect(await pick.accepted).toMatchObject({ ok: true });
    await pick.done;
    expect(t.turns.at(-1)!.message).toContain("Brief of feynman in Spanish.");
    expect(t.turns.at(-1)!.message).not.toContain("French");
  });

  it("a resumed task from before a restart reads the saved language, as before", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 2, phase: { id: "main", startedAt: NOW }, resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current }, extra: { language: async () => "fr" } });
    await t.manager.ask("Hi");
    expect(t.turns[0].message).toContain("Brief of main in French.");
  });
});

describe("TaskManager: the close phase is the core closing (task-phases spec D5)", () => {
  it("the person's Finish in the close phase runs the closing turn and ends the task", async () => {
    const t = setup({ script: [[ok], [ok], [saveNote, ok]] });
    await t.manager.start("session");
    await t.manager.setPhase("close", "t1").done;
    const r = t.manager.setPhase("close", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "closing" });
    await r.done;
    expect(t.turns.at(-1)!.message).toBe(CLOSE_PROMPT);
    expect(t.turns.at(-1)!.options).toMatchObject({ phase: "close", taskPhase: "close", quiet: true });
    expect(t.state().current).toBeNull();
    expect(t.state().actions).toEqual({ session: "done" });
    expect(t.written[0].meta).toMatchObject({ action: "session" });
  });

  it("the agent says the close phase is done: closed at once with auto, else a proposal to finish", async () => {
    const auto = setup({ phases: [PHASES[0], { ...PHASES[2], auto: true }], script: [[ask("close"), ok], [ask("close", "All summed up"), ok], [saveNote, ok]] });
    await auto.manager.start("session");
    expect(auto.turns.map((x) => x.options.phase)).toEqual(["run", "phase-change", "close"]);
    expect(auto.state().current).toBeNull();

    const asks = setup({ script: [[ok], [ask("close", "All summed up"), ok]] });
    await asks.manager.start("session");
    await asks.manager.setPhase("close", "t1").done;
    expect(asks.turns).toHaveLength(2);
    expect(asks.state().current).toMatchObject({ phase: { id: "close" }, phaseProposal: { to: "close", reason: "All summed up" } });
  });

  it("the same id in any other phase does nothing", async () => {
    const t = setup({ script: [[ask("warmup"), ok]] });
    await t.manager.start("session");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).not.toHaveProperty("phaseProposal");
  });
});

describe("TaskManager: the time box (task-phases spec §5)", () => {
  const box: HarnessTimeBox = { options: [10, 20], default: null, wrapUpAt: 0.5 };
  // The agent hears the time left through a brief's `{{timeLeft}}` (and a change's "Time left:" line).
  const timed: Partial<TaskDeps> = { readPhaseBrief: async (_action, phase) => `Brief of ${phase}. Time left: {{timeLeft}}.` };

  it("D0: no time box, no timer, no field", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session");
    await t.manager.start("quiz");
    expect(t.timers).toEqual([]);
    expect(t.state().current).not.toHaveProperty("timeBox");
  });

  it("is chosen at the start among the options, counts, and is shown; a length not offered starts nothing", async () => {
    const t = setup({ timeBox: box });
    await expect(t.manager.start("session", undefined, undefined, undefined, { timeBox: 15 })).rejects.toThrow("Unknown time box");
    expect(t.turns).toHaveLength(0);
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    expect(t.state().current?.timeBox).toEqual({ minutes: 10, usedMs: 0, runningSince: NOW });
    // A one-second minute in the test: the wrap-up is due at half of 10 s.
    expect(t.timers.at(-1)?.ms).toBe(5000);
    // The first message tells the agent, whether or not the brief uses `{{timeLeft}}`.
    expect(t.turns[0].message.endsWith("\n\nTime left: about 10 minutes.")).toBe(true);
    t.advance(2000);
    await t.manager.ask("Go on");
    expect(t.views.at(-1)?.current?.timeBox).toMatchObject({ minutes: 10, totalMs: 10_000, usedMs: 2000, paused: false });
  });

  it("the default applies to a start the window doesn't make itself", async () => {
    const t = setup({ timeBox: { ...box, default: 20 } });
    await t.manager.start("session");
    expect(t.state().current?.timeBox).toMatchObject({ minutes: 20 });
  });

  it("at wrapUpAt: one wrap-up turn, then the close phase by the app; the window hears both first", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.fire();
    await vi.waitFor(() => expect(t.turns).toHaveLength(3));
    await t.manager.idle();
    expect(t.turns[1].message).toBe(wrapUpPrompt("en"));
    expect(t.turns[1].options).toMatchObject({ phase: "wrap-up", wrapUp: true, display: "Time is almost up", taskPhase: "warmup" });
    expect(t.turns[2].options).toMatchObject({ phase: "phase-change", phaseChange: "close" });
    expect(t.notices).toEqual([
      { task: "t1", kind: "wrap-up" },
      { task: "t1", kind: "phase", phase: "close", by: "app" },
    ]);
    expect(t.state().current).toMatchObject({ phase: { id: "close" }, timeBox: { wrappedUp: true } });
    // Next: the end, at 100%. It moves nowhere: the close phase already started.
    t.fire();
    await t.manager.idle();
    await vi.waitFor(() => expect(t.state().current?.timeBox).toMatchObject({ ended: true }));
    expect(t.turns).toHaveLength(3);
  });

  it("never cuts a turn: a step due during a turn waits for it", async () => {
    let open!: () => void;
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    const t2 = setup({ timeBox: box, state: t.state(), gate: new Promise<void>((resolve) => (open = resolve)) });
    const asked = t2.manager.ask("A long question");
    await vi.waitFor(() => expect(t2.turns).toHaveLength(1));
    t2.fire();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t2.turns).toHaveLength(1);
    open();
    await asked;
    await vi.waitFor(() => expect(t2.turns[1]?.options).toMatchObject({ phase: "wrap-up" }));
  });

  it("whenSettled waits for a step due during a turn and the turns it starts, then reads", async () => {
    let open!: () => void;
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    const t2 = setup({ timeBox: box, state: t.state(), gate: new Promise<void>((resolve) => (open = resolve)) });
    const asked = t2.manager.ask("A long question");
    await vi.waitFor(() => expect(t2.turns).toHaveLength(1));
    t2.fire();
    open();
    await asked;
    // The person's line comes now, while the step waits or runs: it settles after the wrap-up and the move.
    expect(await t2.manager.whenSettled(async () => t2.turns.length)).toBe(3);
    expect(t2.turns[1].options).toMatchObject({ phase: "wrap-up" });
    expect(t2.turns[2].options).toMatchObject({ phase: "phase-change", phaseChange: "close" });
  });

  it("pause (only while waiting), resume, a message resumes, +5 min, quitting pauses", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.advance(1000);
    expect(await t.manager.pauseTimeBox()).toBe(true);
    expect(t.state().current?.timeBox).toEqual({ minutes: 10, usedMs: 1000 });
    expect(t.timers).toEqual([]);
    expect(t.views.at(-1)?.current?.timeBox).toMatchObject({ paused: true });
    expect(await t.manager.resumeTimeBox()).toBe(true);
    expect(t.timers).toHaveLength(1);
    await t.manager.pauseTimeBox();
    await t.manager.ask("I'm back");
    expect(t.state().current?.timeBox?.runningSince).toBeDefined();
    expect(await t.manager.extendTimeBox()).toBe(true);
    expect(t.state().current?.timeBox?.minutes).toBe(15);
    // Resolves once the pause is written, and no timer is left.
    await t.manager.close();
    expect(t.state().current?.timeBox).not.toHaveProperty("runningSince");
    expect(t.timers).toEqual([]);
  });

  it("a resumed session tells the agent the time left, like the first message; D0 without a box", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 2, resume: true as const, timeBox: { minutes: 10, usedMs: 4000 } };
    const t = setup({ timeBox: box, phases: [], state: { version: 1, actions: {}, current } });
    await t.manager.ask("Hi");
    expect(t.turns[0].message).toBe(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session\n\n{{notesIndex}}", timeLeft: "about 6 minutes", message: "Hi" }));
    expect(t.turns[0].message).toContain("\n\nTime left: about 6 minutes.\n\n## The person's message\nHi");
    const { timeBox: _box, ...plain } = current;
    const d0 = setup({ timeBox: box, phases: [], state: { version: 1, actions: {}, current: plain } });
    await d0.manager.ask("Hi");
    expect(d0.turns[0].message).not.toContain("Time left");
  });

  it("a mode's tier floor starts the new task with the person's time box, not the action's default", async () => {
    const modes = { socratic: { label: "Socratic" }, feynman: { label: "Feynman", minTier: "deep" as const } };
    const run = async (minutes: number | null) => {
      const t = setup({
        timeBox: { ...box, default: 20 },
        modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" },
        extra: { modes },
        script: [[ok], [saveNote, ok], [ok]],
      });
      await t.manager.start("session", undefined, undefined, undefined, { timeBox: minutes });
      if (minutes !== null) await t.manager.extendTimeBox();
      t.advance(3000);
      const { accepted, done } = t.manager.chooseMode("feynman", { belowTier: "new-task" });
      expect(await accepted).toEqual({ ok: true, switched: "new-task" });
      await done;
      expect(t.state().current).toMatchObject({ id: "t2", mode: "feynman" });
      return t.state().current?.timeBox;
    };
    // Kept even when a "+5 min" made it a length the action doesn't offer, with the time already used: no fresh clock.
    expect(await run(10)).toEqual({ minutes: 15, usedMs: 3000, runningSince: new Date(Date.parse(NOW) + 3000).toISOString() });
    expect(await run(null)).toBeUndefined();
  });

  it("a mode's tier floor keeps the wrap-up done: the new task's next step is the end", async () => {
    const modes = { socratic: { label: "Socratic" }, feynman: { label: "Feynman", minTier: "deep" as const } };
    const opts = { timeBox: box, modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" }, extra: { modes } };
    const first = setup(opts);
    await first.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    const state = first.state();
    state.current!.timeBox = { minutes: 10, usedMs: 6000, wrappedUp: true };
    const t = setup({ ...opts, state, script: [[saveNote, ok], [ok]] });
    const { accepted, done } = t.manager.chooseMode("feynman", { belowTier: "new-task" });
    expect(await accepted).toEqual({ ok: true, switched: "new-task" });
    await done;
    expect(t.state().current?.timeBox).toMatchObject({ minutes: 10, usedMs: 6000, wrappedUp: true });
    expect(t.timers.at(-1)?.ms).toBe(4000);
  });

  it("without phases, the first message still tells the agent the time box", async () => {
    const t = setup({ timeBox: box, phases: [] });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 20 });
    expect(t.turns[0].message).toBe("# Task: session\n\nTime left: about 20 minutes.");
  });

  it("any turn the person starts resumes a paused box: a phase pick, a mode pick", async () => {
    const t = setup({ timeBox: box, modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" } });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    await t.manager.pauseTimeBox();
    await t.manager.setPhase("main", "t1").done;
    expect(t.state().current?.timeBox?.runningSince).toBeDefined();
    await t.manager.pauseTimeBox();
    const pick = t.manager.chooseMode("feynman");
    expect(await pick.accepted).toEqual({ ok: true, switched: "turn" });
    await pick.done;
    expect(t.state().current?.timeBox?.runningSince).toBeDefined();
  });

  it("a pause is refused while a turn runs", async () => {
    let open!: () => void;
    const t = setup({ timeBox: box, gate: new Promise<void>((resolve) => (open = resolve)) });
    const started = t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    await expect(t.manager.pauseTimeBox()).rejects.toThrow("A turn is already running");
    open();
    await started;
    expect(t.state().current?.timeBox?.runningSince).toBeDefined();
  });

  it("one pending step: writes during a long turn arm nothing more, and the wrap-up runs once", async () => {
    let open!: () => void;
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    const t2 = setup({ timeBox: box, state: t.state(), gate: new Promise<void>((resolve) => (open = resolve)) });
    const asked = t2.manager.ask("A long question");
    await vi.waitFor(() => expect(t2.turns).toHaveLength(1));
    t2.fire();
    const armed = t2.timers.length;
    await t2.manager.extendTimeBox(0);
    await t2.manager.extendTimeBox(0);
    expect(t2.timers).toHaveLength(armed);
    open();
    await asked;
    await vi.waitFor(() => expect(t2.turns).toHaveLength(3));
    await t2.manager.idle();
    expect(t2.turns.filter((x) => x.options.phase === "wrap-up")).toHaveLength(1);
    expect(t2.notices.filter((x) => x.kind === "wrap-up")).toHaveLength(1);
  });

  it("+5 min after the end runs the end again, never the wrap-up", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.fire();
    await vi.waitFor(() => expect(t.turns).toHaveLength(3));
    await t.manager.idle();
    t.fire();
    await vi.waitFor(() => expect(t.state().current?.timeBox).toMatchObject({ ended: true }));
    await t.manager.idle();
    expect(await t.manager.extendTimeBox()).toBe(true);
    expect(t.state().current?.timeBox).toMatchObject({ minutes: 15, wrappedUp: true });
    expect(t.state().current?.timeBox).not.toHaveProperty("ended");
    expect(t.timers.at(-1)?.ms).toBe(5000);
    t.fire();
    await vi.waitFor(() => expect(t.state().current?.timeBox).toMatchObject({ ended: true }));
    await t.manager.idle();
    expect(t.turns).toHaveLength(3);
    expect(t.notices.filter((x) => x.kind === "wrap-up")).toHaveLength(1);
  });

  it("without a close phase: the wrap-up, then only the view says the time is up", async () => {
    const t = setup({ timeBox: box, phases: PHASES.slice(0, 2) });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.fire();
    await vi.waitFor(() => expect(t.turns).toHaveLength(2));
    await t.manager.idle();
    expect(t.state().current).toMatchObject({ phase: { id: "warmup" }, timeBox: { wrappedUp: true } });
    expect(t.views.at(-1)?.current?.timeBox).toMatchObject({ wrappedUp: true });
  });

  it("a task whose session is gone: no wrap-up turn, the close phase quietly; its resumed session hears the time left", async () => {
    const current = {
      id: "t1",
      action: "session",
      status: "waiting" as const,
      startedAt: "",
      turns: 1,
      phase: { id: "main", startedAt: NOW },
      timeBox: { minutes: 10, usedMs: 4000, runningSince: NOW },
      resume: true as const,
    };
    const t = setup({ timeBox: box, state: { ...emptyTasks(), current }, extra: timed });
    // A write arms the timer: the wrap-up is due in a second.
    expect(await t.manager.extendTimeBox(0)).toBe(true);
    expect(t.timers.at(-1)?.ms).toBe(1000);
    t.fire();
    await vi.waitFor(() => expect(t.state().current).toMatchObject({ phase: { id: "close" }, timeBox: { wrappedUp: true } }));
    await t.manager.idle();
    expect(t.turns).toEqual([]);
    expect(t.notices).toEqual([]);
    await t.manager.ask("Hi");
    expect(t.turns[0].message).toContain("about 5 minutes");
  });

  it("a due checkpoint runs before the wrap-up, in the same operation", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    const s = t.state();
    s.current = { ...s.current!, profile: { ...profile, cap: 1000 }, context: { used: 900 } };
    const t2 = setup({ timeBox: box, state: s, phases: PHASES.slice(0, 2) });
    expect(await t2.manager.extendTimeBox(0)).toBe(true);
    t2.fire();
    await vi.waitFor(() => expect(t2.turns).toHaveLength(2));
    await t2.manager.idle();
    expect(t2.turns.map((x) => x.options.phase)).toEqual(["checkpoint", "wrap-up"]);
  });
});

describe("TaskManager: the phaseMoved hook (sidekick spec §2a.2 phase-change)", () => {
  it("is told the phase left and the one entered, for the agent's move and the person's", async () => {
    const moved: unknown[] = [];
    const t = setup({ script: [[ask("main", "Recall done"), ok], [ok]], extra: { phaseMoved: (e) => void moved.push(e) } });
    await t.manager.start("session");
    expect(moved).toEqual([{ task: { id: "t1", action: "session", scope: "main" }, from: "warmup", to: "main" }]);
    const r = t.manager.setPhase("close", "t1");
    await r.accepted;
    await r.done;
    expect(moved.at(-1)).toEqual({ task: { id: "t1", action: "session", scope: "main" }, from: "main", to: "close" });
    // The same phase moves nothing.
    const same = t.manager.setPhase("close", "t1");
    await same.accepted;
    await same.done;
    expect(moved).toHaveLength(2);
  });

  it("a throwing hook never stops the move", async () => {
    const t = setup({
      script: [[ask("main"), ok], [ok]],
      extra: {
        phaseMoved: () => {
          throw new Error("boom");
        },
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.manager.start("session");
    expect(t.state().current?.phase?.id).toBe("main");
    expect(t.turns).toHaveLength(2);
    err.mockRestore();
  });

  it("D0: no hook, the same moves", async () => {
    const t = setup({ script: [[ask("main", "Recall done"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.state().current?.phase?.id).toBe("main");
    expect(t.turns).toHaveLength(2);
  });
});
