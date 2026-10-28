import type { InputSpec } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { UsageTally, formatReport } from "../src/report";
import { TerminalView, errorMessage } from "../src/terminal";
import { memoryStream } from "./helpers";

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite });

describe("TerminalView", () => {
  it("prints text, activities, custom blocks as JSON, numbered choices and errors in the app's words", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "text", delta: "Hello" });
    view.event({ type: "activity", id: "a1", kind: "read", detail: "README.md", state: "start" });
    view.event({ type: "activity", id: "a1", kind: "read", detail: "README.md", state: "end" });
    view.event({ type: "block", name: "example_card", data: { title: "One idea" } });
    view.event({ type: "block", name: "choices", data: { options: [{ label: "Go deeper", followUp: "More" }, { label: "Next", next: true }] } });
    view.event({ type: "block", name: "save_note", data: { title: "x" } });
    view.event({ type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
    view.event({ type: "done", ok: false, error: { code: "session-expired" } });
    expect(out.text()).toBe(
      ["Hello", "  · read: README.md", "  [example_card]", "    {", '      "title": "One idea"', "    }", "", "  1. Go deeper", "  2. Next", "✗ Your Claude session ended. Sign in again to continue.", ""].join("\n"),
    );
    expect(view.choices.map((o) => o.label)).toEqual(["Go deeper", "Next"]);
  });

  it("prints one Documents line per card at the end of the turn (document-reader §5.3)", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "text", delta: "Wrote it." });
    view.event({
      type: "documents",
      documents: [
        { path: "tickets/MUS-412/analysis.md", title: "Analysis", change: "new", words: 300 },
        { path: "README.md", title: "Read me", change: "updated", words: 3 },
      ],
    });
    view.event({ type: "done", ok: true });
    expect(out.text()).toBe(["Wrote it.", "Documents: tickets/MUS-412/analysis.md (new)", "Documents: README.md (updated)", ""].join("\n"));
  });

  it("skips a card whose path is nothing once control characters are removed", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({
      type: "documents",
      documents: [
        { path: "\x1b\x07", title: "Bad", change: "new", words: 1 },
        { path: "a.md", title: "A", change: "new", words: 1 },
      ],
    });
    expect(out.text()).toBe("Documents: a.md (new)\n");
  });

  it("dims activities on a terminal", () => {
    const out = memoryStream();
    new TerminalView(out.stream, "Codex", true).event({ type: "activity", id: "a", kind: "web", detail: "search", state: "start" });
    expect(out.text()).toBe("\x1b[2m  · web: search\x1b[0m\n");
  });

  it("draws recommend_mode as text with how to pick; malformed data draws nothing", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude", false, {});
    view.event({ type: "block", name: "recommend_mode", data: { recommended: "socratic", reasons: ["One key idea."], alternatives: [{ mode: "feynman", why: "To say it back." }] } });
    view.event({ type: "block", name: "recommend_mode", data: { recommended: "Bad Id", reasons: [] } });
    expect(out.text()).toBe("\n  Recommended mode: socratic\n    - One key idea.\n  Or:\n    feynman: To say it back.\n  Type m <mode> to pick one.\n");
  });

  it("draws only the modes the task's action lists, and no terminal control characters", () => {
    const out = memoryStream();
    let listed: readonly string[] = ["socratic", "feynman"];
    const view = new TerminalView(out.stream, "Claude", false, {}, () => listed);
    view.event({
      type: "block",
      name: "recommend_mode",
      data: {
        recommended: "socratic",
        reasons: ["One\x1b[31m key\nidea.\x07"],
        alternatives: [
          { mode: "worked", why: "Not listed." },
          { mode: "feynman", why: "To say\r it back." },
        ],
      },
    });
    expect(out.text()).toBe("\n  Recommended mode: socratic\n    - One[31m key idea.\n  Or:\n    feynman: To say it back.\n  Type m <mode> to pick one.\n");
    // A recommended mode the action doesn't list: nothing at all.
    listed = ["feynman"];
    view.event({ type: "block", name: "recommend_mode", data: { recommended: "socratic", reasons: ["One key idea."] } });
    expect(out.text()).not.toContain("Recommended mode: socratic\n    - One key idea.");
  });

  it("drops a reason left empty once its control characters go", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude", false, {});
    view.event({ type: "block", name: "recommend_mode", data: { recommended: "socratic", reasons: ["\x07\n ", "One key idea."] } });
    expect(out.text()).toBe("\n  Recommended mode: socratic\n    - One key idea.\n  Type m <mode> to pick one.\n");
  });

  it("prints a turn the app starts on its own as its line: the part's label, or the wrap-up", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.taskTurn({ task: "t1", kind: "phase", phase: "main", by: "agent" }, "Main block");
    expect(out.text()).toBe("\n— Main block —\n");
    view.taskTurn({ task: "t1", kind: "wrap-up" });
    expect(out.text()).toBe("\n— Main block —\n\nTime is almost up\n");
  });

  it("prints a proposal with how to act on it, and never the set_phase call", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "block", name: "set_phase", data: { to: "close", reason: "Covered." } });
    view.proposal({ to: "close", reason: "Covered." }, "Close", false);
    view.proposal({ to: "close", reason: "All\x1b[2J summed up" }, "Close", true);
    expect(out.text()).toBe(
      "\nThe AI proposes to move to Close: Covered. Type >phase close to go there.\n\nThe AI says this part is done: All[2J summed up. Type q to finish.\n",
    );
  });

  it("reads error messages from the core's English strings", () => {
    expect(errorMessage("engine-not-installed", "Codex")).toBe("I can't find Codex on this computer.");
    expect(errorMessage("something-new", "Codex")).toBe("something-new");
  });
});

describe("TerminalView: input blocks", () => {
  const spec: InputSpec = { fields: [{ name: "why", kind: "longText", label: "Why", optional: false }], skippable: true };

  it("shows an input block's data, then what to answer, and keeps its data by id", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude", false, { commit_answer: spec });
    view.event({ type: "block", name: "commit_answer", data: { question: "¿Quién?" }, id: "t1:0:0" });
    expect(out.text()).toContain("  [commit_answer]");
    expect(out.text()).toContain("    Answer with a: Why (longText) · can be skipped");
    expect(view.shown.get("t1:0:0")).toEqual({ question: "¿Quién?" });
  });

  it("a block named like an Object method is no input block: printed as before (D0)", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "block", name: "constructor", data: { a: 1 }, id: "t1:0:0" });
    expect(out.text()).toBe('  [constructor]\n    {\n      "a": 1\n    }\n');
    expect(view.shown.size).toBe(0);
  });

  it("shows annotate marks, one per line", () => {
    const out = memoryStream();
    const view = new TerminalView(out.stream, "Claude");
    view.event({ type: "block", name: "annotate", data: { ref: "last", marks: [{ quote: "two halves", kind: "ok", comment: "Right." }, { quote: "pizza", kind: "gap" }] } });
    expect(out.text()).toBe('  [annotate]\n    ✓ "two halves" — Right.\n    … "pizza"\n');
  });
});

describe("UsageTally and formatReport", () => {
  it("adds tokens per phase: the first turn is run, later ones of the same task follow-up", () => {
    const tally = new UsageTally();
    const meta = { task: "t1", tier: "standard" as const, model: "sonnet", effort: "medium" as const, cap: 200_000 };
    tally.add({ ...meta, phase: "run" }, usage(1200, 80, 900), true);
    tally.add({ ...meta, phase: "run", reportedModel: "claude-sonnet-4-6" }, usage(300, 40, 1800), true);
    tally.add({ ...meta, phase: "close" }, usage(100, 20), true);
    tally.add({ ...meta, task: "t2", phase: "run" }, usage(10, 1), true);
    tally.context(2100);
    tally.context(1500);
    const report = tally.report({ folder: "/w", action: "example", cost: "light" });
    expect(report).toEqual({
      folder: "/w",
      action: "example",
      cost: "light",
      tier: "standard",
      model: "sonnet",
      reportedModel: "claude-sonnet-4-6",
      effort: "medium",
      cap: 200_000,
      peakContext: 2100,
      phases: {
        run: { turns: 2, input: 1210, output: 81, cacheRead: 900, cacheWrite: 0 },
        "follow-up": { turns: 1, input: 300, output: 40, cacheRead: 1800, cacheWrite: 0 },
        close: { turns: 1, input: 100, output: 20, cacheRead: 0, cacheWrite: 0 },
      },
    });
    const text = formatReport({ ...report, notePath: "/w/.harness/notes/example.md" });
    expect(text).toContain("  model         sonnet (engine reported: claude-sonnet-4-6)");
    expect(text).toMatch(/ {2}run\s+2\s+1,210\s+81\s+900\s+0\n/);
    expect(text).toContain("  peak context  2,100 of 200,000 (1%)");
    expect(text).toContain("  verdict       used about 1,751 tokens (input+output, uncached), plus 2,700 cache read and 0 cache write; cost hint says light");
    expect(text).toContain("  usage log     /w/.harness/usage.jsonl");
    expect(text).toContain("  note          /w/.harness/notes/example.md");
  });

  it("a first turn that failed (a model fallback) still counts as run", () => {
    const tally = new UsageTally();
    tally.add({ task: "t1", phase: "run", tier: "deep", model: "opus", effort: "high", cap: 400_000 }, undefined, false);
    tally.add({ task: "t1", phase: "run", tier: "standard", model: "sonnet", effort: "high", cap: 400_000 }, usage(5, 5), true);
    const report = tally.report({ folder: "/w", action: "a", cost: "medium" });
    expect(report.phases).toEqual({ run: { turns: 2, input: 5, output: 5, cacheRead: 0, cacheWrite: 0 } });
    expect(report.model).toBe("sonnet");
    expect(formatReport(report)).toContain("  model         sonnet\n");
  });
});
