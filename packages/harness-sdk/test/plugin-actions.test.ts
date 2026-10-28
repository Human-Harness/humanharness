import { describe, expect, it } from "vitest";
import { checkActionVars, fillActionPrompt, preparedTitle, promptPlaceholders } from "../src";

const action = {
  id: "triage",
  label: "Triage",
  tier: "light" as const,
  scope: "none" as const,
  vars: { type: "object", properties: { key: { type: "string", maxLength: 20 }, n: { type: "integer", minimum: 1 } }, required: ["key"], additionalProperties: false },
  prompt: "Triage {{key}} ({{n}}). Write nothing without asking.",
};

describe("checkActionVars (P6)", () => {
  it("accepts declared, valid vars", () => expect(checkActionVars(action, { key: "DOC-1", n: 2 })).toEqual({ ok: true, vars: { key: "DOC-1", n: 2 } }));
  it.each([
    ["missing required", { n: 1 }],
    ["unknown key", { key: "A", extra: "x" }],
    ["wrong type", { key: 5 }],
    ["schema limit", { key: "x".repeat(21) }],
    ["not an object", "DOC-1"],
    ["null", null],
    ["array", ["DOC-1"]],
    ["too large", { key: "A", n: 1, pad: "x".repeat(5000) }],
    ["too large, short strings", { key: "A", n: 1, list: Array.from({ length: 50 }, () => "y".repeat(100)) }],
  ])("refuses %s", (_n, vars) => expect(checkActionVars(action, vars).ok).toBe(false));
  it("caps every string at 200 characters even when the schema allows more, deep", () => {
    const wide = { ...action, vars: { type: "object", properties: { key: { type: "string" }, list: { type: "array", items: { type: "string" } } }, required: ["key"] } };
    expect(checkActionVars(wide, { key: "x".repeat(201) }).ok).toBe(false);
    expect(checkActionVars(wide, { key: "a", list: ["y".repeat(201)] }).ok).toBe(false);
    expect(checkActionVars(wide, { key: "a", list: ["y".repeat(200)] }).ok).toBe(true);
  });
  it("an action whose vars schema leaves the allowlist refuses every call instead of throwing", () => {
    expect(checkActionVars({ vars: { type: "object", properties: { key: { type: "string", pattern: "^a" } } } }, { key: "a" }).ok).toBe(false);
  });
});

describe("fillActionPrompt (P6)", () => {
  it("fills literally, in one pass", () => {
    expect(fillActionPrompt(action.prompt, { key: "{{n}}", n: 3 })).toEqual({ ok: true, text: "Triage {{n}} (3). Write nothing without asking." });
  });
  it("refuses an unfilled placeholder", () => expect(fillActionPrompt(action.prompt, { key: "A" })).toEqual({ ok: false, message: 'No value for "n"' }));
  it("a placeholder named like an Object.prototype member is not filled from the prototype", () => {
    expect(fillActionPrompt("{{constructor}}", {})).toEqual({ ok: false, message: 'No value for "constructor"' });
  });
  it("objects and arrays are JSON, strings verbatim, control characters removed", () => {
    expect(fillActionPrompt("{{a}}|{{b}}", { a: ["x"], b: "l1\u0000l2\nl3" })).toEqual({ ok: true, text: '["x"]|l1l2\nl3' });
  });
  it("bidi overrides and zero-width characters are removed, so the card shows what the agent reads", () => {
    expect(fillActionPrompt("{{a}}", { a: "ab\u202edc\u200bx" })).toEqual({ ok: true, text: "abdcx" });
  });
  it("placeholders are listed once each, only `{{name}}` with a var-name shape", () => {
    expect(promptPlaceholders("{{a}} {{ b }} {{a}} {{secret:x}} {{c-d}}")).toEqual(["a"]);
  });
});

describe("preparedTitle (Decision 10)", () => {
  it("adds the first required short string var", () => {
    expect(preparedTitle("On-call", action, { key: "DOC-123", n: 1 })).toBe("On-call · Triage DOC-123");
    expect(preparedTitle("On-call", action, { key: "x".repeat(41) })).toBe("On-call · Triage");
  });
  it("no required string var: the label alone", () => {
    expect(preparedTitle("On this day", { label: "Explain this event", vars: { type: "object", properties: {} } }, {})).toBe("On this day · Explain this event");
  });
});
