import { describe, expect, it } from "vitest";
import { defineHarness, hasExpects, hasPre, PRE_TOKENS_DEFAULT } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false }, blocks: {}, author: "x",
  tools: { "due-today": "./tools/due-today.ts", "warmup-cards": "./tools/warmup-cards.ts", "apply-evidence": "./tools/apply-evidence.ts" },
};
const study = (extra: Record<string, unknown> = {}) => ({ label: "Study", prompt: "./prompts/study.md", cost: "light" as const, ...extra });

describe("pre and expects in the manifest (tools spec §3, §6)", () => {
  it("D0: no pre, preTokens or expects without them", () => {
    const h = defineHarness({ ...base, actions: { study: study({ phases: [{ id: "main", label: "Main" }] }) } });
    expect("pre" in h.actions.study).toBe(false);
    expect("preTokens" in h.actions.study).toBe(false);
    expect("expects" in h.actions.study.phases![0]).toBe(false);
    expect(hasPre(h)).toBe(false);
    expect(hasExpects(h)).toBe(false);
  });
  it("keeps pre steps, preTokens and expects", () => {
    const h = defineHarness({
      ...base,
      actions: {
        study: study({
          pre: [{ tool: "due-today", as: "today" }, { tool: "warmup-cards", args: { n: 3 }, input: ["today"], as: "warmup", required: true }],
          preTokens: 3000,
          phases: [{ id: "main", label: "Main" }, { id: "close", label: "Close", expects: ["apply-evidence"] }],
        }),
      },
    });
    expect(h.actions.study.pre).toHaveLength(2);
    expect(h.actions.study.preTokens).toBe(3000);
    expect(h.actions.study.phases![1].expects).toEqual(["apply-evidence"]);
    expect(hasPre(h)).toBe(true);
    expect(hasExpects(h)).toBe(true);
    expect(PRE_TOKENS_DEFAULT).toBe(4000);
  });
  it("refuses a pre step naming no tool of the harness", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "nope" }] }) } })).toThrow(/pre\[0\]: \\"nope\\" is not a tool of this harness/);
  });
  it("refuses input or forEach naming no earlier as", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "warmup-cards", input: ["today"] }, { tool: "due-today", as: "today" }] }) } })).toThrow(
      /pre\[0\]: input \\"today\\" names no earlier step's as/,
    );
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "warmup-cards", forEach: "x" }] }) } })).toThrow(/pre\[0\]: forEach \\"x\\" names no earlier step's as/);
  });
  it("refuses two steps with the same as, a bad as, more than 10 steps and preTokens outside 500–20,000", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today", as: "a" }, { tool: "due-today", as: "a" }] }) } })).toThrow(/as \\"a\\" is used twice/);
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today", as: "A b" }] }) } })).toThrow();
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: Array.from({ length: 11 }, () => ({ tool: "due-today" })) }) } })).toThrow();
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today" }], preTokens: 499 }) } })).toThrow();
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today" }], preTokens: 20_001 }) } })).toThrow();
  });
  it("refuses preTokens without pre, and expects naming no tool", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ preTokens: 1000 }) } })).toThrow(/preTokens needs pre/);
    expect(() => defineHarness({ ...base, actions: { study: study({ phases: [{ id: "main", label: "Main", expects: ["nope"] }] }) } })).toThrow(/expects \\"nope\\" is not a tool of this harness/);
  });
  it("refuses pre or expects in a harness without tools", () => {
    const { tools: _t, ...noTools } = base;
    expect(() => defineHarness({ ...noTools, actions: { study: study({ pre: [{ tool: "due-today" }] }) } })).toThrow(/is not a tool of this harness/);
    expect(() => defineHarness({ ...noTools, actions: { study: study({ phases: [{ id: "main", label: "Main", expects: ["due-today"] }] }) } })).toThrow(
      /expects \\"due-today\\" is not a tool of this harness/,
    );
  });
});
