import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClaudeScript, ClaudeStep } from "@humanharness/fake-agent";
import { hasJobs, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { hostMode } from "../src/main/board-host";
import { jobFirstMessage } from "../src/main/jobs/job-prompt";
import { QUESTION_PROMPT, closePrompt, fillPrompt } from "../src/main/task-prompts";

// The e2e (parallel.spec.ts) drives fake-claude with these scenarios: each prompt the app sends must reach the turn
// meant for it, the way fake-claude picks one (the first `match` that matches the prompt, else `steps`).
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/parallel-harness");
const { scenarios } = JSON.parse(fs.readFileSync(path.join(DIR, "fake-script.json"), "utf8")) as { scenarios: Record<string, ClaudeScript> };
const pick = (s: ClaudeScript, prompt: string): ClaudeStep[] => s.turns?.find((t) => new RegExp(t.match).test(prompt))?.steps ?? s.steps;
const brief = (action: string) => fillPrompt(fs.readFileSync(path.join(DIR, "agent", "tasks", `${action}.md`), "utf8"), { language: "en", notesIndex: "" });
/** A job's first message, as jobMessageFor builds it for this fixture (no notes, no data, no material). */
const jobPrompt = (job: string) =>
  jobFirstMessage({
    brief: fs.readFileSync(path.join(DIR, "jobs", `${job}.md`), "utf8"),
    scope: "main",
    notesIndex: async () => "",
    actions: { "write-a": "Write A", "write-b": "Write B" },
  });
const question = (q: string) => fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: "", question: q });

/** What a turn does, in order: edits named, files written, sleeps, text, MCP tools called, the result. */
function trace(steps: ClaudeStep[]): string[] {
  return steps.flatMap((s): string[] => {
    if ("sleep" in s) return [`sleep ${s.sleep}`];
    if ("write" in s) return [`write ${s.write.path}`];
    if ("mcp" in s) return s.mcp.tool === "job_result" ? [`mcp job_result ${JSON.stringify(s.mcp.args)}`] : [`mcp ${s.mcp.tool}`];
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

  it.each(["parallel", "slow"])("%s: each job's first message reaches its own turn (part 3 Task 12)", async (name) => {
    const s = scenarios[name];
    expect(trace(pick(s, await jobPrompt("sync")))).toEqual(["text Synced.", 'mcp job_result {"status":"ok","summary":"Synced"}', "result"]);
    expect(trace(pick(s, await jobPrompt("check")))).toEqual([
      "text Two tickets have no criteria.",
      'mcp job_result {"status":"needs-you","summary":"2 tickets without AC","action":"write-a"}',
      "result",
    ]);
    // The asker tries to ask first: the job's ui server refuses it, then it reports it failed.
    expect(trace(pick(s, await jobPrompt("asker")))).toEqual(["mcp show_choices", 'mcp job_result {"status":"failed","summary":"Could not ask"}', "result"]);
    // The silent one ends with text only: no job_result.
    expect(trace(pick(s, await jobPrompt("silent")))).toEqual(["text Looked around.", "result"]);
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

// The jobs-only fixture (part 3): jobs without `parallel`, so the app takes the single path; its e2e uses scenario "jobs".
const JOBS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/jobs-harness");

describe("the jobs fixture (jobs without parallel)", () => {
  it("loads with two jobs and no parallel, so the app takes the single path", async () => {
    const h = await loadHarness(path.join(JOBS_DIR, "harness.config.ts"));
    expect(h.id).toBe("jobs");
    expect(h.parallel).toBeUndefined();
    expect(hasJobs(h)).toBe(true);
    expect(hostMode(h)).toBe("single");
    expect(Object.keys(h.actions)).toEqual(["write-a"]);
    expect(Object.fromEntries(Object.entries(h.jobs!).map(([id, j]) => [id, j.on]))).toEqual({ sync: { start: true, manual: true }, check: { manual: true } });
    for (const j of Object.values(h.jobs!)) expect(fs.existsSync(resolveInHarness(h, j.prompt!))).toBe(true);
    expect(fs.existsSync(resolveInHarness(h, h.actions["write-a"].prompt))).toBe(true);
    expect(fs.existsSync(path.join(JOBS_DIR, "ui", "App.tsx"))).toBe(true);
  });

  it("its scenario routes each job and the task as parallel-harness's does", async () => {
    const { scenarios: jobsScenarios } = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, "fake-script.json"), "utf8")) as { scenarios: Record<string, ClaudeScript> };
    expect(Object.keys(jobsScenarios)).toEqual(["jobs"]);
    const s = jobsScenarios.jobs;
    const prompt = async (job: string) =>
      jobFirstMessage({ brief: fs.readFileSync(path.join(JOBS_DIR, "jobs", `${job}.md`), "utf8"), scope: "main", notesIndex: async () => "", actions: { "write-a": "Write A" } });
    expect(trace(pick(s, await prompt("sync")))).toEqual(["text Synced.", 'mcp job_result {"status":"ok","summary":"Synced"}', "result"]);
    expect(trace(pick(s, await prompt("check")))).toEqual([
      "text Two tickets have no criteria.",
      'mcp job_result {"status":"needs-you","summary":"2 tickets without AC","action":"write-a"}',
      "result",
    ]);
    const writeA = fillPrompt(fs.readFileSync(path.join(JOBS_DIR, "agent", "tasks", "write-a.md"), "utf8"), { language: "en", notesIndex: "" });
    expect(trace(pick(s, writeA))).toEqual(["edit a.md", "write a.md", "sleep 800", "text Wrote a.", "mcp show_choices", "result"]);
    expect(trace(pick(s, "Go on."))).toEqual(["text Noted.", "mcp show_choices", "result"]);
    expect(trace(pick(s, closePrompt([])))).toEqual(["mcp save_note", "text Saved.", "result"]);
    for (const steps of [s.steps, ...(s.turns ?? []).map((t) => t.steps)]) {
      expect(steps[0]).toEqual({ line: { type: "system", subtype: "init", session_id: "fake-session" } });
      expect((steps.at(-1) as { line: { type: string; usage?: unknown } }).line).toMatchObject({ type: "result", usage: expect.anything() });
    }
  });
});
