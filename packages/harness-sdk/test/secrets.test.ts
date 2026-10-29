import { describe, expect, it } from "vitest";
import { SECRETS_MAX, defineHarness, hasSecrets } from "../src";

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

  it("a connect step needs secrets in the manifest", () => {
    expect(() => defineHarness({ ...base, setup: [connect] })).toThrow(/declare secrets/);
  });
});
