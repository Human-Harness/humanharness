import { describe, expect, it } from "vitest";
import type { SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { type Note, type NoteMeta, buildNotesIndex } from "@humanharness/workspace";
import { ScopeRequired, TaskManager } from "../src/main/task-manager";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const label = (en: string) => ({ es: en, en });
const saved: SavedNote = { title: "Fractions", summary: ["halves"], decisions: ["use pizzas"], files: [], open: [] };
const ok: Event = { type: "done", ok: true };
const saveNote: Event = { type: "block", name: "save_note", data: saved };
const note = (slug: string, dir: string): Note => ({
  slug,
  path: `.harness/notes/${dir}${slug}.md`,
  title: `Note ${slug}`,
  date: "2026-10-20T10:00:00.000Z",
  engine: "claude",
  summary: [`about ${slug}`],
  decisions: [`decided ${slug}`],
  files: [],
  open: [],
});

/** A task manager over memory for a harness with scopes (or without, `scoped: false`). Notes are kept per scope; "flat" is the folder without scopes. */
function setup(opts: { scoped?: boolean; state?: TasksFile; notes?: Record<string, Note[]>; script?: Event[][]; data?: (scope: string, action?: string) => string } = {}) {
  let state = opts.state ?? emptyTasks();
  const notes: Record<string, Note[]> = structuredClone(opts.notes ?? {});
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const written: { slug: string; scope?: string; args: number }[] = [];
  const trailers: unknown[] = [];
  let busy = false;
  let n = 0;
  const manager = new TaskManager({
    store: { load: async () => structuredClone(state), save: async (s) => void (state = structuredClone(s)) },
    turns: {
      isBusy: () => busy,
      cancel: () => {},
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { study: { label: label("Study") }, review: { label: label("Review") }, onboarding: { label: label("Welcome"), scope: "none" } },
    path: ["study", "review"],
    scoped: opts.scoped ?? true,
    scopeExists: async (id) => ["fracciones", "decimales"].includes(id),
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async (scope?: string) => [...(notes[scope ?? "flat"] ?? [])],
    writeNote: async (...args: [string, SavedNote, NoteMeta, string?]) => {
      const [slug, note, meta, scope] = args;
      written.push({ slug, ...(scope ? { scope } : {}), args: args.length });
      (notes[scope ?? "flat"] ??= []).unshift({ slug, path: `.harness/notes/${scope ? `${scope}/` : ""}${slug}.md`, ...note, ...meta });
    },
    endSession: async () => {},
    saveHistory: async (_message, trailer) => void trailers.push(trailer),
    changed: () => {},
    ...(opts.data ? { dataContext: async (scope: string, action?: string) => opts.data!(scope, action) } : {}),
    now: () => new Date("2026-10-25T10:00:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, written, trailers, notes, state: () => state };
}

describe("TaskManager with scopes", () => {
  it("refuses a required action with no scope open, and starts nothing", async () => {
    const t = setup();
    await expect(t.manager.start("study")).rejects.toBeInstanceOf(ScopeRequired);
    expect(t.turns).toEqual([]);
    expect(t.state().current).toBeNull();
  });

  it("runs a task in the open scope: its note, its status, its trailer and its chat", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    expect(await t.manager.switchScope("fracciones")).toBe(true);
    await t.manager.start("study");
    expect(t.turns[0].options).toMatchObject({ task: "t1", action: "study", scope: "fracciones", chat: "fracciones" });
    expect(t.state().current).toMatchObject({ id: "t1", action: "study", scope: "fracciones", status: "waiting" });
    await t.manager.start("review");
    expect(t.turns[1].options).toMatchObject({ phase: "close", scope: "fracciones" });
    expect(t.written).toEqual([{ slug: "study", scope: "fracciones", args: 4 }]);
    expect(t.trailers).toEqual([{ task: "t1", action: "study", scope: "fracciones" }]);
    expect(t.state().scopes).toEqual({ fracciones: { study: "done" } });
    expect(t.state().actions).toEqual({});
  });

  it("gives a new session its scope's notes, the app-wide notes trimmed, then the data", async () => {
    const t = setup({
      notes: { fracciones: [note("f1", "fracciones/")], decimales: [note("d1", "decimales/")], _app: [note("a1", "_app/")] },
      data: (scope, action) => `## Data: concepts\n(${scope}, ${action})`,
    });
    await t.manager.switchScope("fracciones");
    await t.manager.start("study");
    const first = t.turns[0].message;
    expect(first).toContain("→ .harness/notes/fracciones/f1.md");
    expect(first).toContain("## App-wide notes\n- Note a1: about a1 → .harness/notes/_app/a1.md");
    expect(first).toContain("## App-wide decisions\n- decided a1");
    expect(first).not.toContain("d1");
    expect(first.indexOf("## What we already covered")).toBeLessThan(first.indexOf("## App-wide notes"));
    expect(first.indexOf("## App-wide notes")).toBeLessThan(first.indexOf("## Data: concepts\n(fracciones, study)"));
  });

  it("runs an app-wide action in _app while the chat stays the open scope's", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    await t.manager.switchScope("fracciones");
    await t.manager.start("onboarding");
    expect(t.turns[0].options).toMatchObject({ scope: "_app", chat: "fracciones" });
    expect(await t.manager.runningTask()).toEqual({ id: "t1", action: "onboarding", scope: "_app" });
    expect(await t.manager.trailerNow()).toEqual({ task: "t1", action: "onboarding", scope: "_app" });
    expect(await t.manager.finish()).toBe(true);
    expect(t.written).toEqual([{ slug: "onboarding", scope: "_app", args: 4 }]);
    expect(t.state().scopes).toEqual({ _app: { onboarding: "done" } });
  });

  it("runs a free question in _app when no scope is open, and in the open scope otherwise", async () => {
    const t = setup();
    await t.manager.ask("What is a fraction?");
    expect(t.turns[0].options).toMatchObject({ scope: "_app", chat: "_app" });
    expect(await t.manager.chatScope()).toBe("_app");
    await t.manager.ask("Another one", undefined, "decimales");
    expect(t.turns.at(-1)?.options).toMatchObject({ scope: "decimales", chat: "decimales" });
    expect(t.state().open).toBe("decimales");
  });

  it("closes the open task before switching scope, and refuses an unknown scope", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    await t.manager.switchScope("fracciones");
    await t.manager.start("study");
    expect(await t.manager.switchScope("decimales")).toBe(true);
    expect(t.turns[1].options.phase).toBe("close");
    expect(t.state().current).toBeNull();
    expect(t.state().open).toBe("decimales");
    expect(await t.manager.currentScope()).toBe("decimales");
    await expect(t.manager.switchScope("nope")).rejects.toThrow(/Unknown scope/);
    expect(await t.manager.switchScope(null)).toBe(true);
    expect(t.state()).not.toHaveProperty("open");
  });

  it("walks the guided path with the open scope's statuses", async () => {
    const t = setup({ state: { ...emptyTasks(), open: "decimales", scopes: { fracciones: { study: "done" } } } });
    expect((await t.manager.view()).actions).toEqual({});
    expect((await t.manager.view()).scope).toBe("decimales");
    await t.manager.switchScope("fracciones");
    expect((await t.manager.view()).actions).toEqual({ study: "done" });
    await t.manager.start("study");
    await t.manager.choose({ label: "Next", next: true }, "t1");
    // study is done in fracciones: the path goes on to review.
    expect(t.turns.at(-1)?.message.startsWith("# Task: review")).toBe(true);
  });

  it("starts with a scope argument after switching to it", async () => {
    const t = setup();
    await t.manager.start("study", undefined, "fracciones");
    expect(t.state().open).toBe("fracciones");
    expect(t.turns[0].options).toMatchObject({ scope: "fracciones" });
  });
});

describe("TaskManager without scopes (spec D2)", () => {
  it("runs exactly as before: flat notes, no scope anywhere, the plain notes index", async () => {
    const flat = [note("manifest", "")];
    const t = setup({ scoped: false, notes: { flat }, script: [[ok], [saveNote, ok]] });
    await t.manager.start("study");
    expect(t.turns[0].message).toBe(`# Task: study\n\n${buildNotesIndex(flat)}`);
    expect(t.turns[0].options).not.toHaveProperty("scope");
    expect(t.turns[0].options).not.toHaveProperty("chat");
    expect(t.state().current).not.toHaveProperty("scope");
    expect(await t.manager.finish()).toBe(true);
    expect(t.written).toEqual([{ slug: "study", args: 3 }]);
    expect(t.trailers).toEqual([{ task: "t1", action: "study" }]);
    expect(t.state()).toEqual({ version: 1, engine: "claude", current: null, actions: { study: "done" } });
    expect(await t.manager.view()).not.toHaveProperty("scope");
    expect(await t.manager.chatScope()).toBe("main");
  });

  it("ignores the scope of actions and refuses to switch scope", async () => {
    const t = setup({ scoped: false });
    await t.manager.start("onboarding");
    expect(t.turns[0].options).not.toHaveProperty("scope");
    await expect(t.manager.switchScope("fracciones")).rejects.toThrow(/no scopes/);
  });
});
