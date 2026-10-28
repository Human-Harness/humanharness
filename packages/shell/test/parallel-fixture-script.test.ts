import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClaudeScript, ClaudeStep } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import { hostMode } from "../src/main/board-host";
import { QUESTION_PROMPT, closePrompt, fillPrompt } from "../src/main/task-prompts";

// The e2e (parallel.spec.ts) drives fake-claude with these scenarios: each prompt the app sends must reach the turn
// meant for it, the way fake-claude picks one (the first `match` that matches the prompt, else `steps`).
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/parallel-harness");
const { scenarios } = JSON.parse(fs.readFileSync(path.join(DIR, "fake-script.json"), "utf8")) as { scenarios: Record<string, ClaudeScript> };
const pick = (s: ClaudeScript, prompt: string): ClaudeStep[] => s.turns?.find((t) => new RegExp(t.match).test(prompt))?.steps ?? s.steps;
const brief = (action: string) => fillPrompt(fs.readFileSync(path.join(DIR, "agent", "tasks", `${action}.md`), "utf8"), { language: "en", notesIndex: "" });
const question = (q: string) => fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: "", question: q });

/** What a turn does, in order: edits named, files written, sleeps, text, MCP tools called, the result. */
function trace(steps: ClaudeStep[]): string[] {
  return steps.flatMap((s): string[] => {
    if ("sleep" in s) return [`sleep ${s.sleep}`];
    if ("write" in s) return [`write ${s.write.path}`];
    if ("mcp" in s) return [`mcp ${s.mcp.tool}`];
    if (!("line" in s)) return ["other"];
    const l = s.line as { type: string; message?: { content: { type: string; name?: string; input?: { file_path?: string } }[] }; event?: { delta?: { text?: string } } };
    if (l.type === "assistant") return l.message!.content.map((b) => `edit ${b.input?.file_path}`);
    if (l.type === "stream_event") return l.event?.delta?.text ? [`text ${l.event.delta.text}`] : [];
    if (l.type === "result") return ["result"];
    return [];
  });
}

describe("the parallel fixture's fake-claude scenarios", () => {
  it("the fixture takes the board path", async () => {
    expect(hostMode(await loadHarness(path.join(DIR, "harness.config.ts")))).toBe("board");
  });

  it.each([
    ["parallel", 800, 400],
    ["slow", 5000, 3000],
  ])("%s: each action writes only its own file; a question starting \"both\" writes the shared one", (name, aMs, bothMs) => {
    const s = scenarios[name];
    expect(trace(pick(s, brief("write-a")))).toEqual(["edit a.md", "write a.md", `sleep ${aMs}`, "text Wrote a.", "mcp show_choices", "result"]);
    expect(trace(pick(s, brief("write-b")))).toEqual(["edit b.md", "write b.md", "text Wrote b.", "mcp show_choices", "result"]);
    expect(trace(pick(s, question("both of you: write the spec")))).toEqual([`sleep ${bothMs}`, "edit spec.md", "write spec.md", "text Wrote spec.", "mcp show_choices", "result"]);
    // Only a question that starts with "both" shares the file; any other question, and every follow-up, writes nothing.
    for (const p of [question("Is both fine?"), "Go on.", "That's all for now."]) expect(trace(pick(s, p))).toEqual(["text Noted.", "mcp show_choices", "result"]);
    // The closing turn saves a note and offers no choices (CLOSE_PROMPT asks for none).
    expect(trace(pick(s, closePrompt([])))).toEqual(["mcp save_note", "text Saved.", "result"]);
  });

  it("every turn starts with the session's init line and reports usage, so the task's tokens count", () => {
    for (const s of Object.values(scenarios)) {
      for (const steps of [s.steps, ...(s.turns ?? []).map((t) => t.steps)]) {
        expect(steps[0]).toEqual({ line: { type: "system", subtype: "init", session_id: "fake-session" } });
        const last = steps.at(-1) as { line: { type: string; usage?: unknown } };
        expect(last.line.type).toBe("result");
        expect(last.line.usage).toBeDefined();
      }
    }
  });
});
