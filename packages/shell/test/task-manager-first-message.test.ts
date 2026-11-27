import { describe, expect, it } from "vitest";
import type { ContextItem } from "@humanharness/protocol";
import type { Note } from "@humanharness/workspace";
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
const TABLE = "## Data: tickets\n\n| id |\n|---|\n| T-1 |";
const SECTION = "## From a mod\n\nKeep it short.";
const item: ContextItem = { id: "mod:x", kind: "pinned", label: "Mod · x", tokens: 100 };

describe("the mods' first-message section (on.firstMessage)", () => {
  it("sits after the data and before the material, with its items, in a new task's message", async () => {
    const t = setup({
      extra: {
        notes: async () => NOTES,
        dataContext: async () => TABLE,
        materialContext: async () => "## Material\n\nsheet",
        modContext: async () => ({ text: SECTION, items: [item], excluded: new Set<string>() }),
      },
    });
    await t.manager.start("quiz");
    const m = t.turns[0].message;
    expect(m.indexOf(TABLE)).toBeLessThan(m.indexOf(SECTION));
    expect(m.indexOf(SECTION)).toBeLessThan(m.indexOf("## Material"));
    expect(t.state().current?.start?.map((i) => i.id)).toEqual(["brief", "notes", "data", "mod:x", "material"]);
  });

  it("its excluded notes leave both notes indexes", async () => {
    const appNote = { ...note("c", "2026-10-22T10:00:00.000Z"), path: ".harness/scopes/_app/notes/c.md" };
    const t = setup({
      state: { ...emptyTasks(), open: "s1" },
      extra: {
        scoped: true,
        notes: async (scope?: string) => (scope === "_app" ? [appNote] : NOTES),
        modContext: async () => ({ text: "", items: [], excluded: new Set([".harness/notes/a.md", appNote.path]) }),
      },
    });
    await t.manager.start("quiz");
    const m = t.turns[0].message;
    expect(m).not.toContain(".harness/notes/a.md");
    expect(m).not.toContain(appNote.path);
    expect(m).toContain(".harness/notes/b.md");
  });

  it("joins the core's own pins: both sections, both sets of exclusions", async () => {
    const t = setup({
      extra: {
        notes: async () => NOTES,
        personContext: async () => ({ pinned: "## Pins", items: [], excluded: new Set([".harness/notes/a.md"]) }),
        modContext: async () => ({ text: SECTION, items: [], excluded: new Set([".harness/notes/b.md"]) }),
      },
    });
    await t.manager.start("quiz");
    const m = t.turns[0].message;
    expect(m.indexOf("## Pins")).toBeLessThan(m.indexOf(SECTION));
    expect(m).not.toContain(".harness/notes/a.md");
    expect(m).not.toContain(".harness/notes/b.md");
  });

  it("reaches a resumed task's message too", async () => {
    const state = emptyTasks();
    state.current = { id: "t9", action: "quiz", status: "waiting", startedAt: "2026-10-26T09:00:00.000Z", turns: 2, resume: true };
    const t = setup({ state, extra: { notes: async () => NOTES, modContext: async () => ({ text: SECTION, items: [item], excluded: new Set([".harness/notes/a.md"]) }) } });
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toContain(SECTION);
    expect(t.turns[0].message).not.toContain(".harness/notes/a.md");
    expect(t.state().current?.start?.map((i) => i.id)).toContain("mod:x");
  });

  it("is told which task it is for", async () => {
    const seen: unknown[] = [];
    const t = setup({
      extra: {
        modContext: async (task: unknown) => {
          seen.push(task);
          return null;
        },
      },
    });
    await t.manager.start("quiz");
    expect(seen).toEqual([{ id: t.state().current?.id, action: "quiz", scope: "main" }]);
  });

  it("D0: no section gives the same message, and a failing hook adds nothing", async () => {
    const plain = setup({ extra: { notes: async () => NOTES } });
    await plain.manager.start("quiz");
    for (const modContext of [async () => null, async () => ({ text: "", items: [], excluded: new Set<string>() }), async () => Promise.reject(new Error("boom"))]) {
      const t = setup({ extra: { notes: async () => NOTES, modContext } });
      await t.manager.start("quiz");
      expect(t.turns[0].message).toBe(plain.turns[0].message);
    }
  });
});
