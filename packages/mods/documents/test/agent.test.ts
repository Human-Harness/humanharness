// The agent's side of documents: the writing guide (document-reader spec §4, review spec §4) and the three review tools.
import { MANAGED_END, ReviewRefused, managedSection } from "@humanharness/workspace";
import { describe, expect, it, vi } from "vitest";
import { REVIEW_FAILED, documentsAgent, reviewHandler, writingLines } from "../src/main/agent";

const NAMES = ["ask_in_document", "reply_to_comment", "read_review"];
const KINDS = { adr: { when: "A decision with real alternatives.", sections: ["Status", "Decision"] } };

describe("documentsAgent", () => {
  const info = { canEdit: true, folder: "/work", documentKinds: {} };

  it("gives the guide with the review lines, and the three tools, to an agent that may edit", () => {
    const agent = documentsAgent(async () => null);
    expect(agent.instructions(info)).toEqual(writingLines({ kinds: {}, review: true }));
    const tools = agent.agentTools(info);
    expect(tools.map((t) => t.name)).toEqual(NAMES);
    for (const t of tools) expect(t).toMatchObject({ tasksOnly: true, timeoutError: "The app did not answer; check with read_review before asking again" });
  });

  it('D0: with edit "none", no tools and no review lines', () => {
    const agent = documentsAgent(async () => null);
    expect(agent.instructions({ ...info, canEdit: false })).toEqual(writingLines({ kinds: {} }));
    expect(agent.instructions({ ...info, canEdit: false }).join("\n")).not.toContain("ask_in_document");
    expect(agent.agentTools({ ...info, canEdit: false })).toEqual([]);
  });

  it("D0: with no kinds, no kinds part; with kinds, theirs", () => {
    const agent = documentsAgent(async () => null);
    expect(agent.instructions(info).join("\n")).not.toContain("### Document kinds");
    const withKinds = agent.instructions({ ...info, documentKinds: KINDS }).join("\n");
    expect(withKinds).toContain("### Document kinds");
    expect(withKinds).toContain("- `adr`: A decision with real alternatives.");
    expect(withKinds).toContain("      ## Decision");
  });

  it("each tool makes its request in the runtime's folder", async () => {
    const seen: unknown[] = [];
    const agent = documentsAgent(async (folder, request) => void seen.push([folder, request]));
    for (const t of agent.agentTools(info)) await t.handle({ path: "a.md" });
    expect(seen).toEqual(["ask", "reply", "read"].map((op) => ["/work", { path: "a.md", op }]));
  });

  it("an `op` among a call's arguments never picks another request", async () => {
    const seen: unknown[] = [];
    const agent = documentsAgent(async (_folder, r) => void seen.push(r));
    await agent.agentTools(info)[2].handle({ path: "a.md", op: "ask" });
    expect(seen).toEqual([{ op: "read", path: "a.md" }]);
  });

  it("a tool's refusal reaches the agent; any other failure is one fixed line", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const agent = documentsAgent(async () => {
      throw new Error("EACCES: /Users/someone/Work");
    });
    await expect(agent.agentTools(info)[0].handle({}) as Promise<unknown>).rejects.toThrow(REVIEW_FAILED);
    logged.mockRestore();
  });
});

describe("reviewHandler", () => {
  it("passes the app's refusals to the agent, and a fixed line for any other error", async () => {
    const refused = reviewHandler(async () => {
      throw new ReviewRefused("spec.md has too many comments", "full");
    });
    await expect(refused({})).rejects.toThrow("spec.md has too many comments");
    const failed = reviewHandler(async () => {
      throw new Error("EACCES: /Users/someone/Work/.harness/reviews/spec.md.json");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await failed({}).catch((e: Error) => e);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("/Users");
    expect((err as Error).message).toBe(REVIEW_FAILED);
    const ok = reviewHandler(async (r) => ({ echo: r }));
    await expect(ok({ op: "read" })).resolves.toEqual({ echo: { op: "read" } });
  });
});

/** The managed section with the guide as its one caller section, as the runtime places it. */
const section = (writing: Parameters<typeof writingLines>[0], language: "en" | "es" = "en") =>
  managedSection({ language, blocks: {}, sections: [writingLines(writing)] });

describe("writing for the reader (document-reader spec §4)", () => {
  const GUIDE_START = "### Writing for the reader";

  it("the base guide: last part of the section, English, the six callouts and nothing else", () => {
    const s = section({ kinds: {} }, "es");
    expect(s.trimEnd().endsWith(MANAGED_END)).toBe(true);
    const guide = s.slice(s.indexOf(GUIDE_START), s.indexOf(MANAGED_END));
    expect(guide).toMatchSnapshot();
    for (const c of ["NOTE", "TIP", "WARNING", "SUMMARY", "DECISION", "QUESTION"]) expect(guide).toContain(`[!${c}]`);
    expect([...new Set(guide.match(/\[![A-Z]+\]/g))].sort()).toEqual(["[!DECISION]", "[!NOTE]", "[!QUESTION]", "[!SUMMARY]", "[!TIP]", "[!WARNING]"]);
    expect(guide).not.toContain("### Document kinds");
    expect(guide).toContain("`title` always.");
    expect(guide).not.toContain("`kind`");
  });

  it("with kinds: each kind's id, when and its template (front-matter, then headings in order)", () => {
    const s = section({
      kinds: {
        adr: { when: "A decision with real alternatives.", sections: ["Status", "Context", "Decision"], status: ["proposed", "accepted", "superseded"] },
        analysis: { when: "Exploring options before deciding.", sections: ["Context", "Options"] },
      },
    });
    const kinds = s.slice(s.indexOf("### Document kinds"), s.indexOf(MANAGED_END));
    expect(kinds).toMatchSnapshot();
    expect(kinds).toContain("- `adr`: A decision with real alternatives.");
    expect(kinds).toContain("    status: proposed | accepted | superseded");
    expect(kinds.indexOf("    ## Status")).toBeLessThan(kinds.indexOf("    ## Decision"));
    expect(s).toContain("`title` always, and `kind` when one of the kinds below fits.");
  });

  it("a kind's template is a code block inside its list item, so its headings never render as live headings", () => {
    const s = section({ kinds: { adr: { when: "x", sections: ["Status"] } } });
    const kinds = s.slice(s.indexOf("### Document kinds"), s.indexOf(MANAGED_END));
    // The item's content starts at column 2; a code block inside it needs 4 more spaces.
    for (const line of ["---", "title: …", "kind: adr", "## Status"]) expect(kinds).toContain(`\n      ${line}\n`);
  });
});

describe("writing guide: review lines (review spec §4)", () => {
  it("only with review", () => {
    const without = writingLines({ kinds: {} });
    const withReview = writingLines({ kinds: {}, review: true });
    const added = withReview.filter((l) => !without.includes(l));
    expect(added).toEqual([
      "- **Asking about a passage.** Use `ask_in_document`, and give for each option the full text that replaces the passage.",
      "- **Blocking questions.** Mark a question `blocking` only when the document can't be approved without its answer.",
      "- **Review rounds.** After a review round, answer every comment with `reply_to_comment`.",
    ]);
    expect(withReview.filter((l) => without.includes(l))).toEqual(without);
  });
});
