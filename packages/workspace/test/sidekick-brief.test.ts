import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { sidekickBrief, sidekickWorkDir, writeSidekickBrief } from "../src/sidekick-brief";

describe("sidekick brief", () => {
  it("holds the core rules, the harness and the tips, in English", () => {
    const text = sidekickBrief({ name: "Sidekick", harness: "Essay Coach", tips: "Claims need a source." });
    expect(text).toMatch(/^# Sidekick/);
    expect(text).toContain("Essay Coach");
    expect(text).toMatch(/Answer only with one JSON object/);
    expect(text).toMatch(/Never act/i);
    expect(text).toMatch(/same language as the person's prompt/);
    expect(text).toContain("Claims need a source.");
  });

  it("has no tips section without tips", () => {
    expect(sidekickBrief({ name: "Sidekick", harness: "Notes" })).not.toContain("## Harness tips");
    expect(sidekickBrief({ name: "Sidekick", harness: "Notes", tips: "  \n" })).not.toContain("## Harness tips");
  });

  it("the folder is under userData, per base and sidekick, never inside the base", () => {
    const dir = sidekickWorkDir("/u", "/Users/me/Notes", "sidekick");
    expect(dir.startsWith(path.join("/u", "sidekick"))).toBe(true);
    expect(dir.endsWith(path.join("sidekick"))).toBe(true);
    expect(dir).not.toContain("/Users/me/Notes");
    expect(sidekickWorkDir("/u", "/Users/me/Notes/", "sidekick")).toBe(dir);
    expect(sidekickWorkDir("/u", "/Users/me/Other", "sidekick")).not.toBe(dir);
    expect(() => sidekickWorkDir("/u", "/b", "../x")).toThrow();
  });

  it("writes AGENTS.md and the engine file only when they changed", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sk-"));
    const engine = getEngine("claude");
    expect(await writeSidekickBrief(folder, "# A\n", engine)).toBe(true);
    expect(await fs.readFile(path.join(folder, "AGENTS.md"), "utf8")).toBe("# A\n");
    expect(await fs.readFile(path.join(folder, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(await writeSidekickBrief(folder, "# A\n", engine)).toBe(false);
    expect(await writeSidekickBrief(folder, "# B\n", engine)).toBe(true);
    expect((await fs.readdir(folder)).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  it("writes only AGENTS.md for an engine without its own file", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sk-"));
    expect(await writeSidekickBrief(folder, "# A\n", getEngine("codex"))).toBe(true);
    expect(await fs.readdir(folder)).toEqual(["AGENTS.md"]);
  });
});
