import { describe, expect, it } from "vitest";
import { type PreStep, type StepSource, type ToolMeta, type ToolsJson, sourceProblems, stepProblems } from "../src";

/** A tools.json with one entry per id: an agent: call tool with no params and no returns, changed by its overrides. */
function json(tools: Record<string, Partial<Pick<ToolMeta, "agent" | "params" | "returns">>>): ToolsJson {
  const out: ToolsJson["tools"] = {};
  for (const [id, over] of Object.entries(tools)) {
    const entry: ToolMeta = { description: `The ${id} tool of the study harness`, agent: "call", uses: {}, params: { type: "object", properties: {} }, timeout: 30, file: `tools/${id}.js` };
    if (over.agent) entry.agent = over.agent;
    if (over.params) entry.params = over.params;
    if (over.returns) entry.returns = over.returns;
    out[id] = entry;
  }
  return { version: 1, tools: out };
}

/** A manifest with one action, `study`, whose `tools` list every id its pre-steps and expects use. */
function m(pre: PreStep[], phases?: { id: string; label: string; expects?: string[] }[]) {
  const ids = new Set([...pre.map((s) => s.tool), ...(phases ?? []).flatMap((p) => p.expects ?? [])]);
  return {
    tools: Object.fromEntries([...ids].map((id) => [id, `./tools/${id}.ts`])),
    actions: { study: { ...(pre.length ? { pre } : {}), ...(phases ? { phases } : {}) } },
  };
}
const msgs = (h: ReturnType<typeof m>, j: ToolsJson) => stepProblems(h, j);

describe("stepProblems (tools spec §3.3)", () => {
  it("input names a result whose tool declares returns", () => {
    expect(msgs(m([{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }]), json({ "due-today": { returns: undefined } }))).toContain(
      'study: pre[1]: input "today": due-today declares no returns',
    );
  });

  it("input from a tool that declares returns has no problem", () => {
    const j = json({ "due-today": { returns: { type: "array", items: { type: "string" } } }, "warmup-cards": {} });
    expect(msgs(m([{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }]), j)).toEqual([]);
  });

  it("forEach names a result whose tool declares returns", () => {
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs" }]), json({ "open-prs": {}, "pr-ci": {} }))).toEqual([
      'study: pre[1]: forEach "prs": open-prs declares no returns',
    ]);
  });

  it("forEach names an array result", () => {
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs" }]), json({ "open-prs": { returns: { type: "object", properties: {} } } }))).toContain(
      'study: pre[1]: forEach "prs": open-prs does not return an array',
    );
  });

  it("forEach items carry every required param the args don't give", () => {
    const j = json({
      "open-prs": { returns: { type: "array", items: { type: "object", properties: { repo: { type: "string" } } } } },
      "pr-ci": { params: { type: "object", properties: { repo: { type: "string" }, number: { type: "integer" } }, required: ["repo", "number"] } },
    });
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs" }]), j)).toContain('study: pre[1]: forEach "prs": its items have no "number", a required param of pr-ci');
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs", args: { number: 1 } }]), j)).toEqual([]);
  });

  it("a forEach step's as is an array of its tool's results", () => {
    const j = json({
      "open-prs": { returns: { type: "array", items: { type: "object", properties: { repo: { type: "string" } } } } },
      "pr-ci": { returns: { type: "object", properties: { repo: { type: "string" } } } },
      "ci-sum": { params: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] } },
    });
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs", as: "runs" }, { tool: "ci-sum", forEach: "runs" }]), j)).toEqual([]);
  });

  it("expects names tools the agent can call", () => {
    expect(msgs(m([], [{ id: "close", label: "Close", expects: ["apply-evidence"] }]), json({ "apply-evidence": { agent: "none" } }))).toContain(
      'study: phase close: expects "apply-evidence" is a tool the agent can\'t call (agent: "none")',
    );
    expect(msgs(m([], [{ id: "close", label: "Close", expects: ["apply-evidence"] }]), json({ "apply-evidence": {} }))).toEqual([]);
  });

  it("a tool missing from tools.json adds nothing here (toolProblems reports it)", () => {
    expect(msgs(m([{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }], [{ id: "close", label: "Close", expects: ["gone"] }]), json({}))).toEqual([]);
  });

  it("D0: a manifest without pre or expects has no problems", () => {
    const j = json({ "due-today": { agent: "none" }, "open-prs": { returns: { type: "object", properties: {} } } });
    expect(msgs(m([], [{ id: "main", label: "Main" }]), j)).toEqual([]);
    expect(stepProblems({ actions: { study: {} } }, j)).toEqual([]);
    expect(stepProblems({}, j)).toEqual([]);
  });
});

describe("sourceProblems (shared with job recipes)", () => {
  it("starts from the sources it is given: an AI step's output is read like a tool's returns", () => {
    const j = json({ "pr-ci": { params: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] } } });
    const ai = (returns: Record<string, unknown>) => new Map<string, StepSource>([["picked", { kind: "ai", returns }]]);
    expect(sourceProblems([{ tool: "pr-ci", forEach: "picked" }], j, "steps", ai({ type: "object", properties: {} }))).toEqual([
      'steps[0]: forEach "picked": the AI step does not return an array',
    ]);
    expect(sourceProblems([{ tool: "pr-ci", forEach: "picked" }], j, "steps", ai({ type: "array", items: { type: "object", properties: { number: { type: "integer" } } } }))).toEqual([]);
  });
});
