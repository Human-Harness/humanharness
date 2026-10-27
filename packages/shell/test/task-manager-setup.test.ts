import { describe, expect, it } from "vitest";
import type { Event } from "@humanharness/runtime";
import { TaskManager } from "../src/main/task-manager";
import { interviewSection } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };

/** A task manager over memory: `conocerte` is an interview step's action when `interviews` says so. */
function setup(interviews?: Record<string, string>) {
  let state: TasksFile = emptyTasks();
  const turns: { message: string; options: TurnOptions }[] = [];
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => false,
      cancel: () => {},
      send: async (message, options) => {
        turns.push({ message, options });
        options.onEvent?.(ok);
      },
    },
    actions: { conocerte: { label: "Get to know you" }, practice: { label: "Practice" } },
    path: ["practice"],
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async () => {},
    endSession: async () => {},
    changed: () => {},
    ...(interviews ? { interviews } : {}),
    now: () => new Date("2026-10-27T10:00:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns };
}

describe("an interview step's task (setup-steps spec §3 `interview`)", () => {
  it("the section says: one question at a time, save to the collection as you go, then Next", () => {
    expect(interviewSection("profile")).toBe(
      [
        "## Setup interview",
        "This task is a setup step: get to know the person before they use the app. Ask one question at a time, with `show_choices` or an input block when one fits.",
        "Save what you learn in the `profile` collection with the data tools as you go (data_put the first time, then data_patch).",
        "When the record holds everything its schema asks for, tell the person they can press Next.",
      ].join("\n"),
    );
  });

  it("its first message is the brief, then the section", async () => {
    const t = setup({ conocerte: "profile" });
    await t.manager.start("conocerte");
    expect(t.turns[0].message).toBe(`# Task: conocerte\n\n${interviewSection("profile")}`);
  });

  it("D0: any other action, and every action of a harness without interviews, starts as before", async () => {
    const t = setup({ conocerte: "profile" });
    await t.manager.start("practice");
    expect(t.turns[0].message).toBe("# Task: practice");
    const plain = setup();
    await plain.manager.start("conocerte");
    expect(plain.turns[0].message).toBe("# Task: conocerte");
  });
});
