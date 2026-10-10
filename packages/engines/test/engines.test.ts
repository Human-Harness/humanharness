import { describe, expect, it } from "vitest";
import { ENGINES, availableEngines, getEngine } from "../src";

describe("ENGINES", () => {
  it("pins the Codex ACP adapter and its session modes", () => {
    expect(getEngine("codex").transport).toEqual({
      kind: "acp",
      command: ["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"],
      modes: { edit: "workspace-write", readOnly: "read-only" },
    });
  });
  it("has unique ids and a dated source for every status", () => {
    const ids = ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENGINES) expect(e.statusSource).toMatch(/^https:\/\/\S+ \(\d{4}-\d{2}-\d{2}\)$/);
  });

  it("allows only Claude and Codex in v1", () => {
    expect(ENGINES.filter((e) => e.status === "allowed").map((e) => e.id).sort()).toEqual(["claude", "codex"]);
  });

  it("runs Claude through the official binary, never through ACP", () => {
    expect(getEngine("claude").transport).toEqual({ kind: "claude-cli", binary: "claude" });
  });
});

describe("availableEngines", () => {
  it("offers only allowed engines in distribution builds", () => {
    expect(availableEngines(["claude", "codex", "kimi", "gemini"], "distribution").map((e) => e.id)).toEqual(["claude", "codex"]);
  });

  it("adds pending engines in development, never excluded ones", () => {
    expect(availableEngines(["claude", "kimi", "gemini"], "development").map((e) => e.id)).toEqual(["claude", "kimi"]);
  });

  it("ignores unknown ids", () => {
    expect(availableEngines(["nope", "codex"], "distribution").map((e) => e.id)).toEqual(["codex"]);
  });
});

describe("getEngine", () => {
  it("throws for unknown ids", () => {
    expect(() => getEngine("nope")).toThrow(/Unknown engine/);
  });
});
