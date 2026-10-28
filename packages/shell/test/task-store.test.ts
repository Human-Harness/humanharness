import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { QUESTION_MAX, type TasksFile, TaskStore, emptyTasks, interrupted, scopeOfTask, statusesIn, withStatus } from "../src/main/task-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "f-"));

const waiting: TasksFile = {
  version: 1,
  engine: "claude",
  current: { id: "t1", action: "turn", status: "waiting", startedAt: "2026-10-12T10:00:00.000Z", turns: 2, session: { id: "s1", started: true } },
  actions: { manifest: "done" },
};

describe("TaskStore", () => {
  it("starts empty, saves atomically and reads back", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    expect(await store.load()).toEqual(emptyTasks());
    await store.save(waiting);
    expect(await store.load()).toEqual(waiting);
    expect(fs.readdirSync(path.join(folder, ".harness"))).toEqual(["tasks.json"]);
  });

  it("keeps only what it understands", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(
      path.join(folder, ".harness", "tasks.json"),
      JSON.stringify({ version: 1, actions: { a: "done", b: "weird" }, current: { id: 1 }, engine: 5 }),
    );
    expect(await new TaskStore(folder).load()).toEqual({ version: 1, current: null, actions: { a: "done" } });
  });

  it("sets a file that is not JSON aside and starts empty", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), "{broken");
    expect(await new TaskStore(folder).load()).toEqual(emptyTasks());
    const files = fs.readdirSync(path.join(folder, ".harness"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^tasks\.json\.corrupt-\d+$/);
    expect(fs.readFileSync(path.join(folder, ".harness", files[0]), "utf8")).toBe("{broken");
  });

  it("rethrows a read error other than a missing file", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness", "tasks.json"), { recursive: true });
    await expect(new TaskStore(folder).load()).rejects.toThrow();
  });

  it("keeps the resume flag only as true", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    await store.save({ ...waiting, current: { ...waiting.current!, resume: true } });
    expect((await store.load()).current?.resume).toBe(true);
    fs.writeFileSync(store.file, JSON.stringify({ ...waiting, current: { ...waiting.current, resume: "yes" } }));
    expect((await store.load()).current?.resume).toBeUndefined();
  });
});

describe("TaskStore: the current task, field by field", () => {
  const base = { id: "t1", status: "running", startedAt: "2026-10-12T10:00:00.000Z", turns: 1 };
  const read = async (current: Record<string, unknown>, actions: Record<string, unknown> = {}) => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify({ version: 1, current, actions }));
    return new TaskStore(folder).load();
  };

  it("drops a session whose id would read as a flag", async () => {
    expect((await read({ ...base, session: { id: "--some-flag", started: true } })).current).toEqual(base);
  });

  it("drops a session whose id has whitespace", async () => {
    expect((await read({ ...base, session: { id: "abc def", started: true } })).current).toEqual(base);
    expect((await read({ ...base, session: { id: " abc", started: true } })).current).toEqual(base);
    expect((await read({ ...base, session: { id: "abc\n", started: true } })).current).toEqual(base);
  });

  it("drops a session whose id is not a string or whose started is not a boolean", async () => {
    expect((await read({ ...base, session: { id: 5, started: true } })).current).toEqual(base);
    expect((await read({ ...base, session: { id: "abc", started: "yes" } })).current).toEqual(base);
    expect((await read({ ...base, session: "abc" })).current).toEqual(base);
  });

  it("keeps a session id in the formats the engines produce", async () => {
    for (const id of ["0199a6b2-7c1e-7d3a-9f00-1234567890ab", "fake-acp-session", "fake-acp-session-2", "s1"]) {
      expect((await read({ ...base, session: { id, started: true } })).current?.session).toEqual({ id, started: true });
    }
  });

  it("keeps action and question only as strings", async () => {
    expect((await read({ ...base, action: 3, question: ["x"] })).current).toEqual(base);
    expect((await read({ ...base, action: "turn", question: "why?" })).current).toEqual({ ...base, action: "turn", question: "why?" });
  });

  it("keeps a question up to its bound, marks one cut, and keeps the checkpoint's turn count only as a number", async () => {
    const long = "q".repeat(QUESTION_MAX + 10);
    expect((await read({ ...base, question: long })).current).toEqual({ ...base, question: long.slice(0, QUESTION_MAX), questionCut: true });
    expect((await read({ ...base, question: "why?", questionCut: true })).current).toEqual({ ...base, question: "why?", questionCut: true });
    expect((await read({ ...base, questionCut: "yes" })).current).toEqual(base);
    expect((await read({ ...base, checkpointTurns: 2 })).current).toEqual({ ...base, checkpointTurns: 2 });
    expect((await read({ ...base, checkpointTurns: "2" })).current).toEqual(base);
  });

  it("keeps noteSaved only as a boolean", async () => {
    expect((await read({ ...base, noteSaved: "true" })).current).toEqual(base);
    expect((await read({ ...base, noteSaved: true })).current).toEqual({ ...base, noteSaved: true });
  });

  it("keeps startedAt only as a string", async () => {
    const { startedAt: _s, ...rest } = base;
    expect((await read({ ...rest, startedAt: 12 })).current).toEqual({ ...rest, startedAt: "" });
  });

  it("drops unknown fields and a non-numeric turn count", async () => {
    expect((await read({ ...base, turns: "2", extra: { evil: true } })).current).toEqual({ ...base, turns: 0 });
  });

  it("keeps only known per-action statuses", async () => {
    expect((await read(base, { a: "done", b: "unsaved", c: "unfinished", d: "running", e: 1, f: null })).actions).toEqual({
      a: "done",
      b: "unsaved",
      c: "unfinished",
    });
  });

  it("keeps a task's profile, context and checkpoint flags; drops a profile whose model reads as a flag", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    const profile = { engine: "claude", tier: "deep" as const, model: "opus", effort: "high" as const, cap: 400_000, fallbackFrom: "opus-x" };
    const current = { id: "t1", status: "checkpoint" as const, startedAt: "", turns: 1, profile, context: { used: 320_000, size: 1_000_000 }, checkpointed: true, checkpointNote: true };
    await store.save({ version: 1, current, actions: {} });
    expect((await store.load()).current).toEqual(current);
    fs.writeFileSync(
      store.file,
      JSON.stringify({ version: 1, current: { id: "t1", status: "waiting", startedAt: "", turns: 1, profile: { ...profile, model: "--x" }, context: { used: -1 }, checkpointed: "yes" }, actions: {} }),
    );
    expect((await store.load()).current).toEqual({ id: "t1", status: "waiting", startedAt: "", turns: 1 });
  });

  it("after an engine change: no task carries over, statuses stay, the engine is forgotten", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    await store.save(waiting);
    await store.forgetEngine();
    expect(await store.load()).toEqual({ version: 1, current: null, actions: { manifest: "done", turn: "unfinished" } });
  });
});

describe("interrupted", () => {
  it("ends the open task as unfinished, but a topic already done stays done", () => {
    expect(interrupted(waiting)).toEqual({ ...waiting, current: null, actions: { manifest: "done", turn: "unfinished" } });
    const again = { ...waiting, current: { ...waiting.current!, action: "manifest" } };
    expect(interrupted(again).actions).toEqual({ manifest: "done" });
    const question = { ...waiting, current: { ...waiting.current!, action: undefined } };
    expect(interrupted(question)).toEqual({ ...waiting, current: null });
    expect(interrupted(emptyTasks())).toEqual(emptyTasks());
  });

  it("a task whose checkpoint wrote its note ends done, as a closing turn without a note would", () => {
    const checkpointed = { ...waiting, current: { ...waiting.current!, checkpointNote: true } };
    expect(interrupted(checkpointed).actions).toEqual({ manifest: "done", turn: "done" });
    expect(interrupted(checkpointed, "unsaved").actions).toEqual({ manifest: "done", turn: "done" });
  });
});

describe("scopes in tasks.json", () => {
  it("keeps the open scope, each scope's statuses and the task's scope; drops what is malformed", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".harness"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".harness", "tasks.json"),
      JSON.stringify({
        version: 1,
        open: "fracciones",
        current: { id: "t1", action: "study", status: "waiting", startedAt: "s", turns: 1, scope: "fracciones" },
        actions: { study: "done" },
        scopes: { fracciones: { study: "unsaved", bad: "nope" }, _app: { onboarding: "done" }, main: { x: "done" }, "../x": { y: "done" } },
      }),
    );
    const s = await new TaskStore(dir).load();
    expect(s.open).toBe("fracciones");
    expect(s.current?.scope).toBe("fracciones");
    expect(s.actions).toEqual({ study: "done" });
    expect(s.scopes).toEqual({ fracciones: { study: "unsaved" }, _app: { onboarding: "done" } });
    fs.writeFileSync(path.join(dir, ".harness", "tasks.json"), JSON.stringify({ version: 1, open: "_app", current: { id: "t1", status: "waiting", scope: "../x" }, actions: {} }));
    const bad = await new TaskStore(dir).load();
    expect(bad.open).toBeUndefined();
    expect(bad.current?.scope).toBeUndefined();
    expect(bad).not.toHaveProperty("scopes");
  });

  it("reads and writes a scope's statuses; main's are the old `actions`", () => {
    const s: TasksFile = { ...emptyTasks(), actions: { study: "done" } };
    expect(statusesIn(s, "main")).toEqual({ study: "done" });
    expect(statusesIn(s, "fracciones")).toEqual({});
    const t = withStatus(s, "fracciones", "study", "unsaved");
    expect(t.scopes).toEqual({ fracciones: { study: "unsaved" } });
    expect(t.actions).toEqual({ study: "done" });
    expect(withStatus(s, "main", "review", "done").actions).toEqual({ study: "done", review: "done" });
    expect(scopeOfTask({})).toBe("main");
    expect(scopeOfTask({ scope: "_app" })).toBe("_app");
  });

  it("marks an interrupted task's action in its own scope", () => {
    const s: TasksFile = { ...emptyTasks(), current: { id: "t1", action: "study", status: "waiting", startedAt: "s", turns: 1, scope: "fracciones" } };
    const after = interrupted(s);
    expect(after.current).toBeNull();
    expect(after.scopes).toEqual({ fracciones: { study: "unfinished" } });
    expect(after.actions).toEqual({});
  });
});

describe("TaskStore: task modes (task-modes spec §5.5, §6)", () => {
  const write = (folder: string, current: Record<string, unknown>) => {
    const file = path.join(folder, ".harness", "tasks.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, actions: {}, current: { id: "t1", status: "waiting", startedAt: "", turns: 1, ...current } }));
  };

  it("keeps a well-formed mode, the modes used (distinct, in order) and belowMinTier", async () => {
    const folder = tmp();
    write(folder, { mode: "socratic", modes: ["socratic", "feynman", "socratic", "Bad Id", 3], belowMinTier: true });
    expect((await new TaskStore(folder).load()).current).toMatchObject({ mode: "socratic", modes: ["socratic", "feynman"], belowMinTier: true });
    write(folder, { mode: "../x", modes: "socratic", belowMinTier: "yes" });
    const bad = (await new TaskStore(folder).load()).current;
    expect(bad).not.toHaveProperty("mode");
    expect(bad).not.toHaveProperty("modes");
    expect(bad).not.toHaveProperty("belowMinTier");
  });

  it("drops a mode the manifest no longer declares; belowMinTier goes with its mode", async () => {
    const folder = tmp();
    write(folder, { mode: "socratic", modes: ["socratic", "feynman"], belowMinTier: true });
    const current = (await new TaskStore(folder, { modes: ["feynman"] }).load()).current;
    expect(current).toMatchObject({ modes: ["feynman"] });
    expect(current).not.toHaveProperty("mode");
    expect(current).not.toHaveProperty("belowMinTier");
  });

  it("D0: a task without modes reads with no mode fields", async () => {
    const folder = tmp();
    write(folder, {});
    expect((await new TaskStore(folder).load()).current).toEqual({ id: "t1", status: "waiting", startedAt: "", turns: 1 });
  });
});

describe("TaskStore: task phases and the time box (task-phases spec §6)", () => {
  const write = (folder: string, current: Record<string, unknown>) => {
    const file = path.join(folder, ".harness", "tasks.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, actions: {}, current: { id: "t1", action: "session", status: "waiting", startedAt: "", turns: 1, ...current } }));
  };
  const at = "2026-10-26T10:00:00.000Z";

  it("keeps a well-formed phase, its log, a proposal, a time box and a suspended mode", async () => {
    const folder = tmp();
    write(folder, {
      phase: { id: "main", startedAt: at },
      phases: [{ id: "warmup", at, by: "app" }, { id: "main", at, by: "agent" }, { id: "Bad", at, by: "app" }, { id: "close", at, by: "robot" }],
      phaseProposal: { to: "close", reason: "Done" },
      timeBox: { minutes: 30, usedMs: 1000, runningSince: at, wrappedUp: true, ended: "yes" },
      suspendedMode: "socratic",
    });
    expect((await new TaskStore(folder).load()).current).toMatchObject({
      phase: { id: "main", startedAt: at },
      phases: [{ id: "warmup", at, by: "app" }, { id: "main", at, by: "agent" }],
      phaseProposal: { to: "close", reason: "Done" },
      timeBox: { minutes: 30, usedMs: 1000, runningSince: at, wrappedUp: true },
      suspendedMode: "socratic",
    });
  });

  it("drops what is malformed: a time box without minutes, a proposal without a phase, a suspended mode next to a mode", async () => {
    const folder = tmp();
    write(folder, { phaseProposal: { to: "close", reason: "Done" }, timeBox: { usedMs: 3 }, mode: "feynman", suspendedMode: "socratic" });
    const c = (await new TaskStore(folder).load()).current;
    for (const key of ["phase", "phases", "phaseProposal", "timeBox", "suspendedMode"]) expect(c).not.toHaveProperty(key);
    expect(c).toMatchObject({ mode: "feynman" });
  });

  it("drops a phase the action no longer declares", async () => {
    const folder = tmp();
    write(folder, { phase: { id: "main", startedAt: at }, phases: [{ id: "warmup", at, by: "app" }, { id: "main", at, by: "person" }], phaseProposal: { to: "close", reason: "x" } });
    const c = (await new TaskStore(folder, { phases: { session: ["warmup", "close"] } }).load()).current;
    expect(c).not.toHaveProperty("phase");
    expect(c).not.toHaveProperty("phaseProposal");
    expect(c).toMatchObject({ phases: [{ id: "warmup", at, by: "app" }] });
    // An action that has no phases any more keeps none.
    const none = (await new TaskStore(folder, { phases: { quiz: ["a"] } }).load()).current;
    expect(none).not.toHaveProperty("phases");
  });

  it("D0: a task without phases reads with no phase fields", async () => {
    const folder = tmp();
    write(folder, {});
    expect((await new TaskStore(folder, { phases: {} }).load()).current).toEqual({ id: "t1", action: "session", status: "waiting", startedAt: "", turns: 1 });
  });
});

describe("review fields (review spec §5.3, §5.4)", () => {
  const load = async (current: Record<string, unknown>) => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify({ ...waiting, current: { ...waiting.current, ...current } }));
    return (await new TaskStore(folder).load()).current;
  };

  it("keeps a review task's path and drops one that leaves the folder", async () => {
    expect((await load({ review: "specs/a.md" }))?.review).toBe("specs/a.md");
    expect((await load({ review: "../x.md" }))?.review).toBeUndefined();
  });

  it("keeps the notices that are strings, the last 10, each cut to 600", async () => {
    const many = ["a", 3, "", ...Array.from({ length: 12 }, (_, i) => `n${i}`), "x".repeat(700)];
    const notices = (await load({ notices: many }))?.notices ?? [];
    expect(notices).toHaveLength(10);
    expect(notices[0]).toBe("n3");
    expect(notices.at(-1)).toBe("x".repeat(600));
    expect((await load({ notices: "nope" }))?.notices).toBeUndefined();
  });
});

describe("the context record (context-panel spec §3)", () => {
  const current = (extra: Record<string, unknown>) => ({
    version: 1,
    actions: {},
    current: { id: "t1", status: "waiting", startedAt: "2026-10-28T10:00:00.000Z", turns: 1, ...extra },
  });
  const roundTrip = async (raw: unknown) => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify(raw));
    return new TaskStore(folder).load();
  };

  it("keeps well-formed start items, the first-turn tokens and the reads", async () => {
    const start = [
      { id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: 1200 },
      { id: "notes", kind: "notes-index", label: "Notes (2)", tokens: 300, count: 2, notes: [{ path: ".harness/notes/a.md", title: "A" }], compacted: true },
      { id: "brief:1", kind: "brief", label: "Mode brief", tokens: 200, at: "2026-10-28T10:05:00.000Z" },
      { id: "pin:_app:a.md", kind: "pinned", label: "Pinned · a.md", path: "a.md", tokens: 100, scope: "_app" },
    ];
    const reads = [
      { kind: "read", label: "a.md", path: "a.md", firstAt: "2026-10-28T10:01:00.000Z", count: 2 },
      { kind: "tool", label: "data · data_query", firstAt: "2026-10-28T10:02:00.000Z", count: 1, compacted: true },
    ];
    const loaded = await roundTrip(current({ start, startTokens: 6312, reads }));
    expect(loaded.current).toMatchObject({ start, startTokens: 6312, reads });
  });

  it("drops what has the wrong shape and bounds the lists", async () => {
    const loaded = await roundTrip(
      current({
        start: [
          { id: "x", kind: "nope", label: "x", tokens: 1 },
          { id: "y", kind: "brief", label: "y", tokens: -1 },
          { id: "z", kind: "data", label: "z", tokens: 5, path: "../out" },
          "junk",
        ],
        startTokens: "many",
        reads: [
          { kind: "read", label: "a", firstAt: "T", count: 0 },
          ...Array.from({ length: 600 }, (_, i) => ({ kind: "read", label: `f${i}`, path: `f${i}`, firstAt: "2026-10-28T10:00:00.000Z", count: 1 })),
        ],
      }),
    );
    expect(loaded.current?.start).toEqual([]);
    expect(loaded.current?.startTokens).toBeUndefined();
    expect(loaded.current?.reads).toHaveLength(500);
  });

  it("drops bad optional fields of an item and cuts long labels", async () => {
    const loaded = await roundTrip(
      current({
        start: [
          { id: "notes", kind: "notes-index", label: "n".repeat(500), tokens: 100, at: "nope", count: 1.5, notes: [{ path: "../x.md", title: "X" }, "y"], scope: "../s", compacted: "yes" },
        ],
      }),
    );
    expect(loaded.current?.start).toEqual([{ id: "notes", kind: "notes-index", label: "n".repeat(200), tokens: 100, notes: [] }]);
  });

  it("D0: a task without them has none", async () => {
    const loaded = await roundTrip(current({}));
    expect(loaded.current).not.toHaveProperty("start");
    expect(loaded.current).not.toHaveProperty("reads");
    expect(loaded.current).not.toHaveProperty("startTokens");
  });
});
