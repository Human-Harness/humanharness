import { describe, expect, it } from "vitest";
import type { HarnessTimeBox } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { ContextItem } from "@humanharness/protocol";
import type { Note } from "@humanharness/workspace";
import { READS_MAX, approxTokens } from "../src/main/context-record";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import { profile, setup } from "./task-manager-fixture";

const note = (slug: string, date: string): Note => ({
  slug,
  path: `.harness/notes/${slug}.md`,
  title: `Note ${slug}`,
  date,
  engine: "claude",
  summary: [`about ${slug}`],
  decisions: [],
  files: [],
  open: [],
});
const NOTES = [note("a", "2026-10-20T10:00:00.000Z"), note("b", "2026-10-21T10:00:00.000Z")];
const TABLE = "## Data: tickets\n\n| id |\n|---|\n| T-1 |\n| T-2 |";
const PIN = "## Pinned by the person\n\n### conventions.md\n\n```\nUse pnpm.\n```";
const pinItem: ContextItem = { id: "pin:main:conventions.md", kind: "pinned", label: "Pinned · conventions.md", path: "conventions.md", tokens: 100, scope: "main" };

describe("the start of a task (context-panel spec §3.1)", () => {
  it("records instructions, brief, notes, data and material, in the message's order; they add up to the message", async () => {
    const t = setup({
      extra: {
        notes: async () => NOTES,
        instructionsSize: async () => 4800,
        dataContext: async () => [{ collection: "tickets", rows: 2, text: TABLE }],
        materialContext: async () => "## Material\n\nsheet",
      },
    });
    await t.manager.start("quiz");
    const start = t.state().current?.start ?? [];
    expect(start.map((i) => [i.id, i.kind])).toEqual([
      ["instructions", "instructions"],
      ["brief", "brief"],
      ["notes", "notes-index"],
      ["data:tickets", "data"],
      ["material", "material"],
    ]);
    expect(start[0]).toMatchObject({ path: "AGENTS.md", tokens: approxTokens(4800) });
    expect(start[2]).toMatchObject({ label: "Notes (2)", count: 2, notes: [{ path: ".harness/notes/b.md", title: "Note b" }, { path: ".harness/notes/a.md", title: "Note a" }] });
    expect(start[3]).toMatchObject({ label: "Data · tickets (2 rows)", count: 2 });
    // The brief is what the message holds beyond the other items, so the items add up to the message's estimate.
    const others = start.slice(2).reduce((n, i) => n + i.tokens, 0);
    expect(start[1].tokens).toBe(Math.max(0, approxTokens(t.turns[0].message.length) - others));
  });

  it("D0: no hooks, or hooks with nothing pinned or excluded, give the same first message", async () => {
    const plain = setup({ extra: { notes: async () => NOTES } });
    await plain.manager.start("quiz");
    const hooked = setup({ extra: { notes: async () => NOTES, personContext: async () => ({ pinned: "", items: [], excluded: new Set<string>() }) } });
    await hooked.manager.start("quiz");
    expect(hooked.turns[0].message).toBe(plain.turns[0].message);
  });

  it("pins go after the data and before the material; excluded notes leave the index", async () => {
    const t = setup({
      extra: {
        notes: async () => NOTES,
        dataContext: async () => TABLE,
        materialContext: async () => "## Material\n\nsheet",
        personContext: async () => ({ pinned: PIN, items: [pinItem], excluded: new Set([".harness/notes/a.md"]) }),
      },
    });
    await t.manager.start("quiz");
    const m = t.turns[0].message;
    expect(m.indexOf(TABLE)).toBeLessThan(m.indexOf(PIN));
    expect(m.indexOf(PIN)).toBeLessThan(m.indexOf("## Material"));
    expect(m).not.toContain(".harness/notes/a.md");
    expect(m).toContain(".harness/notes/b.md");
    const start = t.state().current?.start ?? [];
    expect(start.map((i) => i.id)).toEqual(["brief", "notes", "data", "pin:main:conventions.md", "material"]);
    expect(start.find((i) => i.id === "notes")).toMatchObject({ count: 1 });
  });

  it("in a scope, an excluded app-wide note leaves the app-wide index too", async () => {
    const appNote = { ...note("c", "2026-10-22T10:00:00.000Z"), path: ".harness/scopes/_app/notes/c.md" };
    const t = setup({
      state: { ...emptyTasks(), open: "s1" },
      extra: {
        scoped: true,
        notes: async (scope?: string) => (scope === "_app" ? [appNote] : NOTES),
        personContext: async () => ({ pinned: "", items: [], excluded: new Set([appNote.path]) }),
      },
    });
    await t.manager.start("quiz");
    expect(t.turns[0].message).not.toContain(appNote.path);
    expect(t.state().current?.start?.map((i) => i.id)).toEqual(["brief", "notes"]);
  });

  it("a question's brief is the question; a failing hook loads nothing and the task still starts", async () => {
    const t = setup({ extra: { personContext: async () => Promise.reject(new Error("disk")) } });
    await t.manager.ask("What is a fraction?");
    expect(t.state().current?.start?.[0]).toMatchObject({ id: "brief", label: "Question" });
    expect(t.turns).toHaveLength(1);
  });

  it("a resumed task records its resume message instead, and forgets the old first-turn tokens", async () => {
    const state = emptyTasks();
    state.current = {
      id: "t9",
      action: "quiz",
      status: "waiting",
      startedAt: "2026-10-26T09:00:00.000Z",
      turns: 2,
      resume: true,
      start: [{ id: "brief", kind: "brief", label: "Task brief", tokens: 900 }],
      startTokens: 5000,
    };
    const t = setup({ state, extra: { notes: async () => NOTES } });
    await t.manager.ask("Go on");
    const c = t.state().current;
    expect(c?.start?.map((i) => i.id)).toEqual(["brief", "notes"]);
    expect(c?.start?.[0].tokens).not.toBe(900);
  });
});

const read = (id: string, p: string): Event => ({ type: "activity", id, kind: "read", detail: p, state: "start", paths: [`/w/${p}`] });
const usage = (input: number, cacheRead = 0): Event => ({ type: "usage", inputTokens: input, outputTokens: 10, cacheReadTokens: cacheRead, cacheWriteTokens: 0 });
const ok: Event = { type: "done", ok: true };

describe("during the task (context-panel spec §3.2)", () => {
  it("records reads by folder path and tools by name, with counts, once per turn; the first turn's real tokens", async () => {
    const changed: string[] = [];
    const t = setup({
      script: [
        [read("r1", "docs/a.md"), { type: "activity", id: "m1", kind: "other", detail: "", state: "start", tool: { server: "atlassian", name: "getJiraIssue" } }, usage(6000, 300), ok],
        [read("r2", "docs/a.md"), { type: "activity", id: "r3", kind: "read", detail: "x.pdf", state: "start", paths: ["/refs/x.pdf"] }, usage(100), ok],
      ],
      extra: { folder: async () => "/w", contextChanged: (id: string) => void changed.push(id) },
    });
    await t.manager.start("quiz");
    await t.manager.ask("more");
    const c = t.state().current;
    expect(c?.startTokens).toBe(6300);
    expect(c?.reads?.map((r) => [r.kind, r.label, r.path, r.count])).toEqual([
      ["read", "docs/a.md", "docs/a.md", 2],
      ["tool", "atlassian · getJiraIssue", undefined, 1],
      ["read", "x.pdf", undefined, 1],
    ]);
    expect(changed.length).toBeGreaterThanOrEqual(3);
  });

  it("a compaction marks everything before it; a read after it is fresh again", async () => {
    const t = setup({
      script: [[read("r1", "a.md"), ok], [{ type: "compaction" }, { type: "context", used: 1000 }, ok], [read("r2", "a.md"), ok]],
      extra: { folder: async () => "/w" },
    });
    await t.manager.start("quiz");
    await t.manager.ask("one");
    expect(t.state().current?.start?.every((i) => i.compacted === true)).toBe(true);
    expect(t.state().current?.reads?.[0].compacted).toBe(true);
    await t.manager.ask("two");
    expect(t.state().current?.reads?.[0]).not.toHaveProperty("compacted");
  });

  it("reads before a compaction in the same turn are marked; reads after it are fresh", async () => {
    const t = setup({
      script: [[read("r1", "a.md"), read("r2", "b.md"), { type: "compaction" }, read("r3", "c.md"), read("r4", "a.md"), ok]],
      extra: { folder: async () => "/w" },
    });
    await t.manager.start("quiz");
    const reads = t.state().current?.reads ?? [];
    expect(reads.map((r) => [r.path, r.compacted === true])).toEqual([
      ["a.md", false],
      ["b.md", true],
      ["c.md", false],
    ]);
  });

  it("without the folder, reads keep the file name only", async () => {
    const t = setup({ script: [[read("r1", "docs/a.md"), ok]] });
    await t.manager.start("quiz");
    expect(t.state().current?.reads?.map((r) => [r.label, r.path])).toEqual([["a.md", undefined]]);
  });

  it("a first turn without usage leaves no first-turn total, and a later turn's usage is not taken for it", async () => {
    const t = setup({ script: [[ok], [usage(900), ok]] });
    await t.manager.start("quiz");
    await t.manager.ask("more");
    expect(t.state().current).not.toHaveProperty("startTokens");
  });

  it("one turn records at most READS_MAX reads", async () => {
    const many = Array.from({ length: READS_MAX + 30 }, (_, i) => read(`r${i}`, `f${i}.md`));
    const t = setup({ script: [[...many, ok]], extra: { folder: async () => "/w" } });
    await t.manager.start("quiz");
    expect(t.state().current?.reads).toHaveLength(READS_MAX);
  });

  it("a resume marks what the old session read as possibly summarized", async () => {
    const state = emptyTasks();
    state.current = {
      id: "t9",
      action: "quiz",
      status: "waiting",
      startedAt: "2026-10-26T09:00:00.000Z",
      turns: 2,
      resume: true,
      reads: [{ kind: "read", label: "a.md", path: "a.md", firstAt: "2026-10-26T09:00:00.000Z", count: 1 }],
    };
    const t = setup({ state });
    await t.manager.ask("Go on");
    expect(t.state().current?.reads?.[0]).toMatchObject({ path: "a.md", compacted: true });
  });

  it("an action task whose brief can't be read resumes as a 'Task brief', not a 'Question'", async () => {
    const state = emptyTasks();
    state.current = { id: "t9", action: "quiz", status: "waiting", startedAt: "2026-10-26T09:00:00.000Z", turns: 2, resume: true };
    const t = setup({ state, extra: { readPrompt: async () => Promise.reject(new Error("gone")) } });
    await t.manager.ask("Go on");
    expect(t.state().current?.start?.find((i) => i.kind === "brief")).toMatchObject({ id: "brief", label: "Task brief" });
  });

  it("a mode switch and a phase change add their brief with the time it arrived", async () => {
    // No phases, so the switch is a plain mode turn; the task starts in its default mode.
    const t = setup({ phases: [], modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" } });
    await t.manager.start("session");
    await t.manager.chooseMode("feynman").done;
    const briefs = (t.state().current?.start ?? []).filter((i) => i.kind === "brief");
    expect(briefs.length).toBeGreaterThanOrEqual(2);
    expect(briefs.at(-1)).toMatchObject({ id: expect.stringMatching(/^brief:\d+$/), label: "Mode brief · Feynman", at: expect.any(String) });
  });

  it("a Stop before the send takes back the brief it recorded (mode switch, phase change)", async () => {
    const stopAtBrief = (id: string) => {
      let state = emptyTasks();
      let stopped = false;
      const t = setup({
        phases: [],
        modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" },
        extra: {
          store: {
            load: async () => structuredClone(state),
            save: async (s: TasksFile) => {
              state = structuredClone(s);
              if (!stopped && s.current?.start?.some((i) => i.id === id)) {
                stopped = true;
                t.manager.cancel();
              }
            },
          },
        },
      });
      return { t, state: () => state };
    };
    const m = stopAtBrief("brief:1");
    await m.t.manager.start("session");
    await m.t.manager.chooseMode("feynman").done.catch(() => {});
    expect(m.state().current?.start?.map((i) => i.id)).not.toContain("brief:1");
    expect(m.t.turns).toHaveLength(1);

    let state = emptyTasks();
    let stopped = false;
    const p = setup({
      extra: {
        store: {
          load: async () => structuredClone(state),
          save: async (s: TasksFile) => {
            state = structuredClone(s);
            if (!stopped && s.current?.start?.some((i) => i.id === "brief:1")) {
              stopped = true;
              p.manager.cancel();
            }
          },
        },
      },
    });
    await p.manager.start("session");
    await p.manager.setPhase("main").done.catch(() => {});
    expect(state.current?.start?.map((i) => i.id)).not.toContain("brief:1");
    expect(p.turns).toHaveLength(1);
  });

  it("a phase change adds its brief too", async () => {
    const t = setup();
    await t.manager.start("session");
    await t.manager.setPhase("main").done;
    expect(t.state().current?.start?.at(-1)).toMatchObject({ id: "brief:1", label: "Phase brief · Main block", at: expect.any(String) });
  });

  it("D0: no reads, no tools and no usage write nothing new", async () => {
    const t = setup({ script: [[ok]] });
    await t.manager.start("quiz");
    expect(t.state().current).not.toHaveProperty("reads");
    expect(t.state().current).not.toHaveProperty("startTokens");
  });

  it("the resumed turn's usage is the new first-turn total", async () => {
    const state = emptyTasks();
    state.current = { id: "t9", action: "quiz", status: "waiting", startedAt: "2026-10-26T09:00:00.000Z", turns: 2, resume: true, startTokens: 5000 };
    const t = setup({ state, script: [[usage(700), ok]] });
    await t.manager.ask("Go on");
    expect(t.state().current?.startTokens).toBe(700);
  });
});

describe("Add now (context-panel spec §4.1)", () => {
  it("runs one visible turn of kind context-add on the waiting task, told to the window first", async () => {
    const t = setup({ script: [[ok], [read("r1", "docs/conv.md"), ok]], extra: { folder: async () => "/w" } });
    await t.manager.start("quiz");
    const { accepted, done } = t.manager.addContext("t1", "docs/conv.md");
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.notices.at(-1)).toEqual({ task: "t1", kind: "context", path: "docs/conv.md" });
    expect(t.turns[1].message).toContain("take `docs/conv.md` into account");
    expect(t.turns[1].options).toMatchObject({ phase: "context-add", display: "Take docs/conv.md into account", followUp: true, task: "t1" });
    expect(t.state().current?.status).toBe("waiting");
    expect(t.state().current?.reads?.[0]).toMatchObject({ path: "docs/conv.md" });
  });

  it("refuses with no open task, another task's id, a path that breaks the prompt", async () => {
    const t = setup();
    // `done` too: the refused operation still holds the queue until it returns.
    const answer = async (task: string, file: string) => {
      const { accepted, done } = t.manager.addContext(task, file);
      await done;
      return accepted;
    };
    expect(await answer("t1", "a.md")).toEqual({ ok: false, reason: "no-task" });
    await t.manager.start("quiz");
    expect(await answer("t7", "a.md")).toEqual({ ok: false, reason: "no-task" });
    expect(await answer("t1", "a`b.md")).toEqual({ ok: false, reason: "bad-name" });
    expect(t.turns).toHaveLength(1);
    expect(t.notices).toEqual([]);
  });

  it("waits behind a running turn instead of failing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ gate });
    const starting = t.manager.start("quiz");
    await Promise.resolve();
    const { accepted, done } = t.manager.addContext("t1", "a.md");
    release();
    await starting;
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.turns).toHaveLength(2);
  });

  it("refuses a task that isn't waiting with busy", async () => {
    const state = emptyTasks();
    state.current = { id: "t1", action: "quiz", status: "running", startedAt: "", turns: 1 };
    const t = setup({ state });
    const { accepted, done } = t.manager.addContext("t1", "a.md");
    await done;
    expect(await accepted).toEqual({ ok: false, reason: "busy" });
    expect(t.turns).toEqual([]);
  });

  it("resumes a paused time box: the person asked for this turn", async () => {
    const box: HarnessTimeBox = { options: [10, 20], default: null, wrapUpAt: 0.5 };
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    await t.manager.pauseTimeBox();
    expect(t.state().current?.timeBox).not.toHaveProperty("runningSince");
    const { accepted, done } = t.manager.addContext("t1", "a.md");
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.state().current?.timeBox?.runningSince).toBeDefined();
  });

  it("a lost session resumes with it: the resume message carries the prompt, and the turn's usage is the new first-turn total", async () => {
    const state = emptyTasks();
    state.current = { id: "t9", action: "quiz", status: "waiting", startedAt: "2026-10-26T09:00:00.000Z", turns: 2, resume: true, startTokens: 5000 };
    const t = setup({ state, script: [[usage(700), ok]] });
    const { accepted, done } = t.manager.addContext("t9", "a.md");
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.turns[0].message).toContain("# Task: quiz");
    expect(t.turns[0].message).toContain("take `a.md` into account");
    expect(t.turns[0].options).toMatchObject({ phase: "context-add" });
    expect(t.state().current).not.toHaveProperty("resume");
    expect(t.state().current?.startTokens).toBe(700);
  });

  it("a due checkpoint runs first; lines kept for the next message go with it", async () => {
    const state = emptyTasks();
    state.current = {
      id: "t1",
      action: "quiz",
      status: "waiting",
      startedAt: "",
      turns: 3,
      profile: { ...profile, cap: 1000 },
      context: { used: 900 },
      notices: ["The person approved specs/a.md."],
    };
    const t = setup({ state });
    const { accepted, done } = t.manager.addContext("t1", "a.md");
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.turns.map((x) => x.options.phase)).toEqual(["checkpoint", "context-add"]);
    expect(t.turns[1].message.startsWith("The person approved specs/a.md.\n\n")).toBe(true);
    expect(t.state().current).not.toHaveProperty("notices");
  });

  it("contextRecord gives the open task's record, and null for another id", async () => {
    const t = setup({ script: [[usage(500), ok]] });
    expect(await t.manager.contextRecord("t1")).toBeNull();
    await t.manager.start("quiz");
    const r = await t.manager.contextRecord("t1");
    expect(r).toMatchObject({ id: "t1", scope: "main", startTokens: 500, reads: [] });
    expect(r?.start.map((i) => i.id)).toContain("brief");
    expect(await t.manager.contextRecord("t7")).toBeNull();
  });

  it("D0: no Add now, no context-add turn and no context notice", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.ask("Go on");
    expect(t.turns.map((x) => x.options.phase)).not.toContain("context-add");
    expect(t.notices.filter((n) => n.kind === "context")).toEqual([]);
  });
});
