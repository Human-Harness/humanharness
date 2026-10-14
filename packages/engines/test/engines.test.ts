import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGINES, NOTICE_VERSION, availableEngines, brandNames, getEngine, meetsMinVersion, parseVersion } from "../src";

describe("ENGINES", () => {
  it("pins the Codex ACP adapter and its session modes", () => {
    expect(getEngine("codex").transport).toEqual({
      kind: "acp",
      command: ["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"],
      modes: { edit: "workspace-write", readOnly: "read-only" },
      minAdapterVersion: "2.2.2",
    });
    expect(getEngine("codex").detect.minVersion).toBe("0.160.1");
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

describe("engine setup data", () => {
  it("installs, signs in, checks and updates Claude through its official CLI", () => {
    expect(getEngine("claude").setup).toEqual({
      install: { command: "curl -fsSL https://claude.ai/install.sh | bash", docsUrl: "https://code.claude.com/docs/en/setup" },
      login: ["auth", "login"],
      status: { args: ["auth", "status", "--json"], format: "json-logged-in" },
      update: ["update"],
      logout: ["auth", "logout"],
    });
  });

  it("signs in to Codex with `codex login` and reads the status from the exit code", () => {
    expect(getEngine("codex").setup).toMatchObject({
      install: { command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
      login: ["login"],
      status: { args: ["login", "status"], format: "exit-code" },
      logout: ["logout"],
    });
    expect(getEngine("codex").setup?.update).toBeUndefined();
  });

  it("ships a logo file for each engine the app sets up (placeholders until the official assets pass brand review)", () => {
    for (const id of ["claude", "codex"]) {
      const logo = getEngine(id).logo;
      expect(logo).toBe(`assets/${id}.svg`);
      expect(fs.readFileSync(fileURLToPath(new URL(`../${logo}`, import.meta.url)), "utf8")).toMatch(/^<svg /);
    }
  });

  it("names the provider and whether the engine reports plan limits", () => {
    expect([getEngine("claude").provider, getEngine("claude").reportsLimits]).toEqual(["Anthropic", true]);
    expect([getEngine("codex").provider, getEngine("codex").reportsLimits]).toEqual(["OpenAI", false]);
    for (const e of ENGINES) expect(e.provider.length).toBeGreaterThan(0);
  });

  it("names the window Claude's estimates measure and each provider's page of plans", () => {
    expect(getEngine("claude").limits).toEqual({ primary: "five_hour" });
    expect(getEngine("claude").plansUrl).toBe("https://claude.com/pricing");
    expect(getEngine("codex").limits).toBeUndefined();
    expect(getEngine("codex").plansUrl).toBe("https://chatgpt.com/pricing");
  });

  it("starts the legal notice at version 1", () => {
    expect(NOTICE_VERSION).toBe(1);
  });
});

describe("versions", () => {
  it("reads x.y.z from CLI version output", () => {
    expect(parseVersion("2.1.296 (Claude Code)\n")).toBe("2.1.296");
    expect(parseVersion("codex-cli 0.160.1")).toBe("0.160.1");
    expect(parseVersion("command not found")).toBeNull();
  });

  it("compares versions numerically", () => {
    expect(meetsMinVersion("2.1.296", "2.1.296")).toBe(true);
    expect(meetsMinVersion("2.1.300", "2.1.296")).toBe(true);
    expect(meetsMinVersion("3.0.0", "2.9.9")).toBe(true);
    expect(meetsMinVersion("2.1.29", "2.1.296")).toBe(false);
    expect(meetsMinVersion("0.159.9", "0.160.1")).toBe(false);
  });
});

describe("brandNames", () => {
  it("lists every engine's name, its provider and extra marks, once each", () => {
    expect(brandNames()).toEqual(["Claude", "Anthropic", "Codex", "OpenAI", "ChatGPT", "GPT", "Kimi", "Moonshot", "Gemini", "Google", "Qwen", "Alibaba"]);
  });
});
