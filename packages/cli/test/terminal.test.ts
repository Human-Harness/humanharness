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

  it("dims activities on a terminal", () => {
    const out = memoryStream();
    new TerminalView(out.stream, "Codex", true).event({ type: "activity", id: "a", kind: "web", detail: "search", state: "start" });
    expect(out.text()).toBe("\x1b[2m  · web: search\x1b[0m\n");
  });

  it("reads error messages from the core's English strings", () => {
    expect(errorMessage("engine-not-installed", "Codex")).toBe("I can't find Codex on this computer.");
    expect(errorMessage("something-new", "Codex")).toBe("something-new");
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
    expect(text).toContain("  verdict       used about 1,751 tokens; cost hint says light");
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
