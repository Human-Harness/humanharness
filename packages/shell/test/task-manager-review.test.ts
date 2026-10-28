import { describe, expect, it, vi } from "vitest";
import type { Event } from "@humanharness/runtime";
import { APP_SCOPE } from "@humanharness/workspace";
import { RoundNotStarted } from "../src/main/reviews";
import { REVIEW_PROMPT } from "../src/main/task-prompts";
import { NOTICE_MAX, emptyTasks } from "../src/main/task-store";
import { setup } from "./task-manager-fixture";

const ok: Event = { type: "done", ok: true };
const SPEC_PHASES = [
  { id: "spec", label: "Spec", brief: "phases/spec.md", approve: "specs/*.md" },
  { id: "plan", label: "Plan", brief: "phases/plan.md" },
];

describe("review rounds (review spec §5.3)", () => {
  it("go to the waiting task as the person's message", async () => {
    const t = setup();
    await t.manager.start("quiz");
    expect(await t.manager.reviewRound({ path: "specs/a.md", title: "A", message: "Review round for specs/a.md.", tier: "standard" })).toBe("open");
    expect(t.turns.at(-1)?.message).toBe("Review round for specs/a.md.");
    expect(t.turns.at(-1)?.options).toMatchObject({ task: "t1", followUp: true });
  });

  it("with no task, start a core 'Review <title>' task at the given tier", async () => {
    const t = setup();
    expect(await t.manager.reviewRound({ path: "specs/a.md", title: "A", message: "Review round for specs/a.md.", tier: "deep" })).toBe("new");
    expect(t.state().current).toMatchObject({ id: "t1", review: "specs/a.md", question: "Review A\n\nReview round for specs/a.md." });
    expect(t.turns[0].message).toContain("Review round for specs/a.md.");
    expect(t.turns[0].message).toContain("read_review");
    expect(t.profileCalls.at(-1)).toEqual([undefined, undefined, "deep"]);
    expect(REVIEW_PROMPT).toContain("{{question}}");
  });

  it("reject with RoundNotStarted when the turn never started, so the items go back", async () => {
    const refused = { isBusy: () => false, cancel: () => {}, send: async () => Promise.reject(new Error("The app is closing")) };
    const t = setup({ extra: { turns: refused } });
    const err = await t.manager.reviewRound({ path: "specs/a.md", title: "A", message: "Review round for specs/a.md.", tier: "standard" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoundNotStarted);
    expect((err as RoundNotStarted).message).toBe("The app is closing");
    expect(t.state().current).toBeNull();
  });

  it("reject with RoundNotStarted while a turn runs, and send nothing", async () => {
    let release!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (release = r)) });
    const started = t.manager.start("quiz");
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    const err = await t.manager.reviewRound({ path: "specs/a.md", title: "A", message: "Review round for specs/a.md.", tier: "standard" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoundNotStarted);
    expect((err as RoundNotStarted).message).toBe("A turn is already running");
    release();
    await started;
    expect(t.turns).toHaveLength(1);
  });

  it("with scopes, a new review task runs in the record's scope, else the open one, else the app's", async () => {
    const round = { path: "specs/a.md", title: "A", message: "Round.", tier: "standard" as const };
    const inRecord = setup({ state: { ...emptyTasks(), open: "fracciones" }, extra: { scoped: true } });
    await inRecord.manager.reviewRound({ ...round, scope: "algebra" });
    expect(inRecord.state().current?.scope).toBe("algebra");
    const badScope = setup({ state: { ...emptyTasks(), open: "fracciones" }, extra: { scoped: true } });
    await badScope.manager.reviewRound({ ...round, scope: "../x" });
    expect(badScope.state().current?.scope).toBe("fracciones");
    const none = setup({ extra: { scoped: true } });
    await none.manager.reviewRound(round);
    expect(none.state().current?.scope).toBe(APP_SCOPE);
  });
});

describe("approval (review spec §5.4, §5.5)", () => {
  it("leaves a line for the document's task's next message", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.documentApproved({ path: "specs/a.md", task: "t1", reason: "Decided on the call" });
    expect(t.state().current?.notices).toEqual(["The person approved specs/a.md, with reason: Decided on the call."]);
    await t.manager.ask("Next?");
    expect(t.turns.at(-1)?.message).toBe("The person approved specs/a.md, with reason: Decided on the call.\n\nNext?");
    expect(t.turns.at(-1)?.options.display).toBe("Next?");
    expect(t.state().current?.notices).toBeUndefined();
  });

  it("another task's document leaves no line", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.documentApproved({ path: "specs/a.md", task: "other" });
    expect(t.state().current?.notices).toBeUndefined();
  });

  it("moves the task on when its phase's approve glob matches, carrying the line in the change message", async () => {
    const t = setup({ phases: SPEC_PHASES, script: [[ok], [ok]] });
    await t.manager.start("session");
    await t.manager.documentApproved({ path: "specs/a.md", task: "t1" });
    expect(t.state().current).toMatchObject({ phase: { id: "plan" }, phases: [{ id: "spec" }, { id: "plan", by: "person" }] });
    expect(t.turns.at(-1)?.message.startsWith("The person approved specs/a.md.\n\n")).toBe(true);
    expect(t.turns.at(-1)?.options).toMatchObject({ phase: "phase-change", phaseChange: "plan" });
  });

  it("no move for a path the glob doesn't match", async () => {
    const t = setup({ phases: SPEC_PHASES });
    await t.manager.start("session");
    await t.manager.documentApproved({ path: "notes/a.md", task: "t1" });
    expect(t.state().current?.phase?.id).toBe("spec");
    expect(t.turns).toHaveLength(1);
  });

  it("no move while the task isn't waiting; the line still waits for its next message", async () => {
    const current = { id: "t1", action: "session", status: "running" as const, startedAt: "", turns: 1, phase: { id: "spec", startedAt: "" } };
    const t = setup({ phases: SPEC_PHASES, state: { ...emptyTasks(), current } });
    await t.manager.documentApproved({ path: "specs/a.md", task: "t1" });
    expect(t.state().current).toMatchObject({ phase: { id: "spec" }, notices: ["The person approved specs/a.md."] });
    expect(t.state().current?.phases).toBeUndefined();
    expect(t.turns).toHaveLength(0);
  });

  it("cuts the line to NOTICE_MAX when it is written", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.documentApproved({ path: "specs/a.md", task: "t1", reason: "r".repeat(2000) });
    expect(t.state().current?.notices?.[0]).toHaveLength(NOTICE_MAX);
  });

  it("an approve glob on the last phase, or on the close phase, does nothing", async () => {
    for (const last of [
      { id: "plan", label: "Plan", brief: "phases/plan.md", approve: "specs/*.md" },
      { id: "plan", label: "Plan", brief: "phases/plan.md", approve: "specs/*.md", close: true as const },
    ]) {
      const t = setup({ phases: [{ id: "spec", label: "Spec", brief: "phases/spec.md" }, last], script: [[ok], [ok]] });
      await t.manager.start("session");
      const moved = t.manager.setPhase("plan", "t1");
      expect(await moved.accepted).toMatchObject({ ok: true });
      await moved.done;
      const before = { turns: t.turns.length, phases: t.state().current?.phases };
      await t.manager.documentApproved({ path: "specs/a.md", task: "t1" });
      expect(t.state().current?.phase?.id).toBe("plan");
      expect(t.state().current?.phases).toEqual(before.phases);
      expect(t.turns).toHaveLength(before.turns);
      expect(t.state().current?.status).toBe("waiting");
    }
  });
});
