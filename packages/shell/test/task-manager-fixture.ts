import type { ModelProfile } from "@humanharness/engines";
import type { HarnessPhase, HarnessTimeBox, SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskTurnNotice, TaskView } from "@humanharness/protocol";
import type { NoteMeta } from "@humanharness/workspace";
import { type TaskDeps, TaskManager } from "../src/main/task-manager";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

export const ok: Event = { type: "done", ok: true };
export const NOW = "2026-10-26T10:00:00.000Z";
export const PHASES: HarnessPhase[] = [
  { id: "warmup", label: "Warm-up", brief: "phases/warmup.md", auto: true },
  { id: "main", label: "Main block", brief: "phases/main.md" },
  { id: "close", label: "Close", brief: "phases/close.md", close: true },
];
export const brief = (phase: string) => `Brief of ${phase} in {{language}}.`;
export const profile: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };

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
  const profileCalls: unknown[][] = [];
  let clock = Date.parse(NOW);
  let busy = false;
  let gate = opts.gate;
  let n = 0;
  const timers: { fn: () => void; ms: number }[] = [];
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
    profileFor: async (...args) => {
      profileCalls.push(args);
      return profile;
    },
    ...(opts.modes
      ? {
          modes: { socratic: { label: "Socratic" }, feynman: { label: "Feynman" } },
          readModeBrief: async (mode: string) => `Brief of ${mode}.`,
          modeSettings: async () => [],
          tierOf: async () => "standard" as const,
        }
      : {}),
    minuteMs: 1000,
    timer: {
      set: (fn, ms) => {
        const handle = { fn, ms };
        timers.push(handle);
        return handle;
      },
      clear: (handle) => {
        const i = timers.indexOf(handle as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    },
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
    timers,
    profileCalls,
    state: () => state,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Moves the clock to the armed timer's moment and fires it. */
    fire: () => {
      const handle = timers.at(-1);
      if (!handle) throw new Error("No timer is armed");
      clock += handle.ms;
      handle.fn();
    },
  };
}
