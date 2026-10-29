import { describe, expect, it, vi } from "vitest";
import { MOCK_JOB_MARK, isMockJobTurn } from "@humanharness/fake-agent";
import { APP_SCOPE, type Note, buildNotesIndex } from "@humanharness/workspace";
import { JOB_BRIEF_CHARS, jobFirstMessage } from "../../src/main/jobs/job-prompt";
import { notesIndexFor } from "../../src/main/notes-index";

const base = {
  brief: "Sync the tickets.",
  scope: "main",
  notesIndex: async () => "## Notes\n- intro",
  dataContext: async () => "## Data\n| a |",
  materialContext: async () => "",
  actions: { implement: "Implement" },
};

describe("jobFirstMessage (parallel spec §8)", () => {
  it("brief, then the notes index, the data and the material of its scope, then how to end", async () => {
    const m = await jobFirstMessage({ ...base, materialContext: async () => "## Material\n- a.pdf" });
    expect(m.indexOf("Sync the tickets.")).toBeLessThan(m.indexOf("## Notes"));
    expect(m.indexOf("## Notes")).toBeLessThan(m.indexOf("## Data"));
    expect(m.indexOf("## Data")).toBeLessThan(m.indexOf("## Material"));
    expect(m.indexOf("## Material")).toBeLessThan(m.indexOf("job_result"));
    expect(m).toContain("implement (Implement)");
    expect(m).toContain("nobody can answer");
    expect(m).not.toContain("save_note");
    expect(m).not.toMatch(/\n{3,}/);
  });

  it("asks each source for the job's scope", async () => {
    const notesIndex = vi.fn(async () => "");
    const dataContext = vi.fn(async () => "");
    const materialContext = vi.fn(async () => "");
    await jobFirstMessage({ ...base, scope: "acme", notesIndex, dataContext, materialContext });
    expect(notesIndex).toHaveBeenCalledWith("acme");
    expect(dataContext).toHaveBeenCalledWith("acme");
    expect(materialContext).toHaveBeenCalledWith("acme");
  });

  it("leaves out empty and absent sections, and a source that fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await jobFirstMessage({
      brief: "Brief.",
      scope: "main",
      notesIndex: async () => "",
      dataContext: async () => {
        throw new Error("boom");
      },
      actions: {},
    });
    err.mockRestore();
    expect(m.startsWith("Brief.\n\n")).toBe(true);
    expect(m).not.toContain("boom");
    expect(m).toContain("job_result");
  });

  it("without actions, a needs-you result names none", async () => {
    const m = await jobFirstMessage({ ...base, actions: {} });
    expect(m).toContain("leave action out");
    expect(m).not.toContain("name the action");
  });

  it("drops hidden characters from the brief (keeping tab and newline) and cuts it to a bound", async () => {
    const m = await jobFirstMessage({ ...base, brief: "Sync\u202e the\u200b\ttickets.\nThen stop.\u0007" });
    expect(m.startsWith("Sync the\ttickets.\nThen stop.\n\n")).toBe(true);
    const long = await jobFirstMessage({ ...base, brief: "x".repeat(JOB_BRIEF_CHARS + 50) });
    expect(long.split("\n\n")[0]).toHaveLength(JOB_BRIEF_CHARS);
  });

  it("names only well-formed action ids, with their labels on one plain bounded line", async () => {
    const m = await jobFirstMessage({
      ...base,
      actions: { implement: "Impl\nement\u2028now\u200b", "Bad Id\n": "Evil", review: "r".repeat(200) },
    });
    const line = m.split("\n").find((l) => l.includes("implement ("));
    expect(line).toContain("implement (Impl ement now)");
    expect(m).not.toContain("Evil");
    expect(m).toContain(`review (${"r".repeat(79)}…)`);
  });

  it("cuts the brief and a label by code points, never splitting a surrogate pair", async () => {
    const brief = await jobFirstMessage({ ...base, brief: `${"x".repeat(JOB_BRIEF_CHARS - 1)}😀😀` });
    expect(brief.split("\n\n")[0]).toBe(`${"x".repeat(JOB_BRIEF_CHARS - 1)}😀`);
    const m = await jobFirstMessage({ ...base, actions: { review: `${"r".repeat(78)}😀😀😀` } });
    expect(m).toContain(`review (${"r".repeat(78)}😀…)`);
    expect(m).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
  });
});

describe("notesIndexFor (shared with a task's first message)", () => {
  const note = (slug: string): Note => ({
    slug,
    path: `.harness/notes/${slug}.md`,
    title: slug,
    summary: ["s"],
    decisions: [],
    files: [],
    open: [],
    date: "2026-10-28",
    engine: "claude",
  });
  it("without scopes, exactly buildNotesIndex of all notes", async () => {
    const notes = vi.fn(async () => [note("intro")]);
    expect(await notesIndexFor(notes, false, "main")).toBe(buildNotesIndex([note("intro")]));
    expect(notes).toHaveBeenCalledWith(undefined);
  });
  it("in a scope, the scope's index and then the app-wide one", async () => {
    const notes = vi.fn(async (s?: string) => [note(s === APP_SCOPE ? "app-note" : "own-note")]);
    const m = await notesIndexFor(notes, true, "acme");
    expect(notes).toHaveBeenCalledWith("acme");
    expect(notes).toHaveBeenCalledWith(APP_SCOPE);
    expect(m.indexOf("own-note")).toBeLessThan(m.indexOf("## App-wide notes"));
    expect(m).toBe(
      [
        buildNotesIndex([note("own-note")]),
        buildNotesIndex([note("app-note")], { budgetTokens: 500, heading: "## App-wide notes", decisionsHeading: "## App-wide decisions", footer: null }),
      ].join("\n\n"),
    );
  });
  it("in a scope without notes of its own, the app-wide index alone, with its footer", async () => {
    const notes = vi.fn(async (s?: string) => (s === APP_SCOPE ? [note("app-note")] : []));
    expect(await notesIndexFor(notes, true, "acme")).toBe(
      buildNotesIndex([note("app-note")], { budgetTokens: 500, heading: "## App-wide notes", decisionsHeading: "## App-wide decisions" }),
    );
  });
});

describe("the job mark mock mode answers (part 3 Decision 10)", () => {
  it("fake-agent's MOCK_JOB_MARK starts a line of every job's first message, and of no action's", async () => {
    const m = await jobFirstMessage(base);
    expect(m.split("\n")).toContain(`${MOCK_JOB_MARK} Don't ask anything.`);
    expect(isMockJobTurn(m)).toBe(true);
    expect(isMockJobTurn(await jobFirstMessage({ ...base, brief: "# Task: implement\n\nWrite it.", actions: {} }))).toBe(true);
    expect(isMockJobTurn("# Task: implement\n\nWrite it.")).toBe(false);
  });
});
