import { describe, expect, it } from "vitest";
import { SECRETS_MAX, type ToolMeta, defineHarness, hasSecrets, setupStepSchema, toolProblems } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: true }, blocks: {}, author: "x",
};
const jira = { id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com → Security → API tokens." };

describe("secrets (tools spec §9)", () => {
  it("D0: no secrets key without it", () => {
    const h = defineHarness(base);
    expect("secrets" in h).toBe(false);
    expect(hasSecrets(h)).toBe(false);
  });

  it("takes a list of declared keys", () => {
    const h = defineHarness({ ...base, secrets: [jira, { id: "github_pat", label: "GitHub token" }] });
    expect(h.secrets).toEqual([jira, { id: "github_pat", label: "GitHub token" }]);
    expect(hasSecrets(h)).toBe(true);
  });

  it("takes up to SECRETS_MAX keys", () => {
    const list = Array.from({ length: SECRETS_MAX }, (_, i) => ({ id: `k${i}`, label: "K" }));
    expect(defineHarness({ ...base, secrets: list }).secrets).toHaveLength(10);
  });

  it("refuses bad ids, duplicates, long labels, unknown fields, an empty list and more than 10", () => {
    const bad = [
      [{ ...jira, id: "Jira" }],
      [{ ...jira, id: "1jira" }],
      [{ ...jira, id: "j".repeat(41) }],
      [jira, jira],
      [{ ...jira, label: "x".repeat(81) }],
      [{ ...jira, label: "" }],
      [{ ...jira, help: "x".repeat(201) }],
      [{ ...jira, extra: 1 }],
      [],
      Array.from({ length: 11 }, (_, i) => ({ id: `k${i}`, label: "K" })),
    ];
    for (const s of bad) expect(() => defineHarness({ ...base, secrets: s } as never)).toThrow();
  });

  it("refuses a hidden character or a line break in a label or help", () => {
    expect(() => defineHarness({ ...base, secrets: [{ ...jira, label: "Jira‮" }] })).toThrow();
    expect(() => defineHarness({ ...base, secrets: [{ ...jira, label: "Jira​" }] })).toThrow();
    expect(() => defineHarness({ ...base, secrets: [{ ...jira, help: "a\nb" }] })).toThrow();
    expect(() => defineHarness({ ...base, secrets: [{ ...jira, help: "a\rb" }] })).toThrow();
  });
});

describe("the connect setup step (tools spec §9)", () => {
  const connect = { id: "jira", kind: "connect" as const, label: "Connect Jira", secrets: ["jira"] };

  it("names declared secrets", () => {
    const h = defineHarness({ ...base, secrets: [jira], setup: [connect] });
    expect(h.setup?.[0]).toMatchObject({ kind: "connect", secrets: ["jira"], required: false });
  });

  it("a secret may appear in several steps", () => {
    const h = defineHarness({ ...base, secrets: [jira], setup: [connect, { ...connect, id: "again", required: true }] });
    expect(h.setup?.map((s) => s.id)).toEqual(["jira", "again"]);
  });

  it("refuses an undeclared secret, an empty list and a secret listed twice", () => {
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, secrets: ["github"] }] })).toThrow(/\\"github\\" is not declared in secrets/);
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, secrets: [] }] })).toThrow();
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, secrets: ["jira", "jira"] }] })).toThrow(/listed twice/);
  });

  it("a connect step lists at most SECRETS_MAX ids", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
    expect(setupStepSchema.safeParse({ ...connect, secrets: ids(SECRETS_MAX) }).success).toBe(true);
    expect(setupStepSchema.safeParse({ ...connect, secrets: ids(SECRETS_MAX + 1) }).success).toBe(false);
  });

  it("a connect step's ids follow the secret id rule", () => {
    for (const id of ["Jira", "1jira", "j".repeat(41), "ji ra", ""]) {
      expect(setupStepSchema.safeParse({ ...connect, secrets: [id] }).success).toBe(false);
    }
    expect(setupStepSchema.safeParse({ ...connect, secrets: ["github_pat"] }).success).toBe(true);
  });

  it("a connect step needs secrets in the manifest", () => {
    expect(() => defineHarness({ ...base, setup: [connect] })).toThrow(/declare secrets/);
  });
});

describe("a connect step's test (tools spec §9, slice 2)", () => {
  const connect = { id: "jira", kind: "connect" as const, label: "Connect Jira", secrets: ["jira"] };
  const withTools = { ...base, secrets: [jira], tools: { "jira-check": "./tools/jira-check.ts" } };
  const meta = (params: Record<string, unknown>): ToolMeta => ({
    description: "Checks that the Jira key works.",
    agent: "none",
    uses: { secrets: ["jira"] },
    params,
    timeout: 30,
    file: "tools/jira-check.js",
  });

  it("D0: a connect step without test parses as before", () => {
    const h = defineHarness({ ...base, secrets: [jira], setup: [connect] });
    expect(h.setup?.[0]).toEqual({ ...connect, required: false });
  });

  it("a connect step's test names a declared tool", () => {
    const h = defineHarness({ ...withTools, setup: [{ ...connect, test: "jira-check" }] });
    expect(h.setup?.[0]).toMatchObject({ kind: "connect", test: "jira-check" });
    expect(() => defineHarness({ ...withTools, setup: [{ ...connect, test: "nope" }] })).toThrow(/\\"nope\\" is not a tool of this harness/);
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, test: "jira-check" }] })).toThrow(/is not a tool of this harness/);
    expect(() => defineHarness({ ...withTools, setup: [{ ...connect, test: "toString" }] })).toThrow(/is not a tool of this harness/);
    expect(setupStepSchema.safeParse({ ...connect, test: "" }).success).toBe(false);
  });

  it("its tool takes no required params", () => {
    const h = defineHarness({ ...withTools, setup: [{ ...connect, test: "jira-check" }] });
    const problems = (params: Record<string, unknown>) =>
      toolProblems(h, { version: 1, tools: { "jira-check": meta(params) } }).map((p) => p.message);
    expect(problems({ type: "object", properties: { project: { type: "string" } } })).toEqual([]);
    expect(problems({ type: "object", properties: { project: { type: "string" } }, required: ["project"] })).toEqual([
      "jira-check: a connect step's test tool can't have required params",
    ]);
    // Not named by a connect step: required params are fine.
    const plain = defineHarness({ ...withTools, setup: [connect] });
    expect(toolProblems(plain, { version: 1, tools: { "jira-check": meta({ type: "object", properties: {}, required: ["x"] }) } })).toEqual([]);
  });
});
