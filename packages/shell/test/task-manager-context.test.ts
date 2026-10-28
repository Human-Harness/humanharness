import { describe, expect, it } from "vitest";
import type { ContextItem } from "@humanharness/ui/client";
import type { Note } from "@humanharness/workspace";
import { approxTokens } from "../src/main/context-record";
import { emptyTasks } from "../src/main/task-store";
import { setup } from "./task-manager-fixture";

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
