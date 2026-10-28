import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CurrentTask,
  LANES_MAX,
  QUESTION_MAX,
  type TasksFile,
  TaskStore,
  cleanLanes,
  emptyTasks,
  interrupted,
  interruptedLanes,
  scopeOfTask,
  statusesIn,
  withStatus,
} from "../src/main/task-store";

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

describe("lanes (parallel spec §6)", () => {
  // Loose on purpose: some tests hand cleanLanes what a hand-edited file could hold.
  const lane = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: "waiting", startedAt: "2026-10-28T10:00:00Z", turns: 1, ...extra }) as CurrentTask;

  it("D0: a file without lanes loads with no new keys and saves back to the same bytes", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    await store.save({ version: 1, current: null, actions: {} });
    expect(Object.keys(JSON.parse(fs.readFileSync(store.file, "utf8"))).sort()).toEqual(["actions", "current", "version"]);
    // A file as today's app writes it: what it loaded, saved back (key order as `clean` builds it).
    await store.save(waiting);
    await store.save(await store.load());
    const before = fs.readFileSync(store.file, "utf8");
    const loaded = await store.load();
    expect(loaded).not.toHaveProperty("lanes");
    expect(loaded).not.toHaveProperty("focus");
    // Loading never writes.
    expect(fs.readFileSync(store.file, "utf8")).toBe(before);
    await store.save(loaded);
    expect(fs.readFileSync(store.file, "utf8")).toBe(before);
  });

  it("D0: a task read as current never gains the lane-only fields", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    fs.mkdirSync(path.dirname(store.file), { recursive: true });
    fs.writeFileSync(store.file, JSON.stringify({ ...waiting, current: { ...waiting.current, tokens: 5, conflict: ["a.md"] } }));
    const c = (await store.load()).current;
    expect(c).not.toHaveProperty("tokens");
    expect(c).not.toHaveProperty("conflict");
  });

  it("round-trips lanes and focus", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    const state: TasksFile = {
      version: 1,
      current: null,
      actions: {},
      lanes: [lane("a", { tokens: 120, conflict: ["spec.md"] })],
      focus: "a",
    };
    await store.save(state);
    expect(await store.load()).toEqual(state);
    await store.save({ ...state, focus: null });
    expect((await store.load()).focus).toBeNull();
  });

  it("cleanLanes keeps valid tasks and drops duplicates and bad entries, field by field as current", () => {
    const lanes = cleanLanes([lane("a"), lane("a", { turns: 9 }), { id: 3 }, lane("b", { status: "running", weird: 1, resume: "yes" }), "x", lane(""), lane("z".repeat(201))]);
    expect(lanes.map((l) => l.id)).toEqual(["a", "b"]);
    expect(lanes[0].turns).toBe(1);
    expect(lanes[1]).toEqual({ id: "b", status: "running", startedAt: "2026-10-28T10:00:00Z", turns: 1 });
    expect(cleanLanes("nope")).toEqual([]);
    expect(cleanLanes({ a: lane("a") })).toEqual([]);
  });

  it("cleanLanes keeps tokens as a non-negative whole number and conflict as at most 20 paths, newest last", () => {
    const paths = Array.from({ length: 25 }, (_, i) => `f${i}.md`);
    const [a, b, c] = cleanLanes([
      lane("a", { tokens: 42, conflict: [...paths, 7, "f24.md"] }),
      lane("b", { tokens: -1, conflict: "x.md" }),
      lane("c", { tokens: 1.5, conflict: [] }),
    ]);
    expect(a.tokens).toBe(42);
    expect(a.conflict).toEqual(paths.slice(-20));
    expect(b).not.toHaveProperty("tokens");
    expect(b).not.toHaveProperty("conflict");
    expect(c).not.toHaveProperty("tokens");
    expect(c).not.toHaveProperty("conflict");
  });

  it("cleanLanes keeps at most LANES_MAX lanes and applies the manifest's modes", () => {
    const many = Array.from({ length: LANES_MAX + 5 }, (_, i) => lane(`t${i}`));
    expect(cleanLanes(many)).toHaveLength(LANES_MAX);
    expect(cleanLanes([lane("a", { mode: "gone" })], { modes: new Set(["kept"]) })[0]).not.toHaveProperty("mode");
  });

  it("load keeps lanes and focus only when the file has them, and treats bad values as nothing", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    fs.mkdirSync(path.dirname(store.file), { recursive: true });
    fs.writeFileSync(store.file, JSON.stringify({ version: 1, current: null, actions: {}, lanes: "x", focus: 4 }));
    expect(await store.load()).toEqual({ version: 1, current: null, actions: {}, lanes: [] });
    fs.writeFileSync(store.file, JSON.stringify({ version: 1, current: null, actions: {}, focus: "z".repeat(201) }));
    expect(await store.load()).toEqual({ version: 1, current: null, actions: {} });
    fs.writeFileSync(store.file, JSON.stringify({ version: 1, current: null, actions: {}, lanes: [lane("a")], focus: null }));
    expect(await store.load()).toEqual({ version: 1, current: null, actions: {}, lanes: [lane("a")], focus: null });
  });

  it("interruptedLanes ends every open lane the way interrupted ends current (Decision 16)", () => {
    const state: TasksFile = {
      version: 1,
      current: null,
      actions: { manifest: "done" },
      scopes: { s1: {} },
      lanes: [
        lane("a", { action: "turn", status: "running" }),
        lane("b", { action: "manifest" }),
        lane("c", { action: "quiz", scope: "s1", checkpointNote: true }),
        lane("d", { question: "why?" }),
      ],
      focus: "a",
    };
    expect(interruptedLanes(state)).toEqual({
      version: 1,
      current: null,
      actions: { manifest: "done", turn: "unfinished" },
      scopes: { s1: { quiz: "done" } },
      lanes: [],
      focus: null,
    });
    // The same outcome as each lane ending as current today.
    const one = interrupted({ ...state, lanes: undefined, focus: undefined, current: state.lanes![0] });
    expect(one.actions).toEqual({ manifest: "done", turn: "unfinished" });
    // D0: a file without lanes is returned as is.
    expect(interruptedLanes(waiting)).toBe(waiting);
  });
});
