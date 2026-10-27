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

  it("leaves no temp file behind when the write fails", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sk-"));
    // A non-empty folder where AGENTS.md goes makes the rename fail.
    await fs.mkdir(path.join(folder, "AGENTS.md", "x"), { recursive: true });
    await expect(writeSidekickBrief(folder, "# A\n", getEngine("claude"))).rejects.toThrow();
    expect((await fs.readdir(folder)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("writes only AGENTS.md for an engine without its own file", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sk-"));
    expect(await writeSidekickBrief(folder, "# A\n", getEngine("codex"))).toBe(true);
    expect(await fs.readdir(folder)).toEqual(["AGENTS.md"]);
  });
});

describe("a brief per sidekick (spec §2a.1)", () => {
  const BASE = { name: "Sidekick", harness: "Essay Coach", tips: "Claims need a source.", learned: ["Writes in Spanish."] };

  it("names the sidekick, carries its personality and only its purposes' tips", () => {
    const b = sidekickBrief({ ...BASE, sidekick: { name: "Rulo", personality: "Direct, dry humour.", purposes: [{ id: "mentor" }] } });
    expect(b).toMatch(/^# Rulo/);
    expect(b).toContain('You are Rulo, a sidekick inside the app "Essay Coach". You never act; you only suggest.');
    expect(b).toContain("## Personality\n\nDirect, dry humour.");
    expect(b).toContain("## Mentor");
    expect(b).not.toContain("## Prompt coach");
    expect(b).toContain("Claims need a source.");
    expect(b).toContain("- Writes in Spanish.");
  });

  it("no personality section when it is empty", () => {
    expect(sidekickBrief({ ...BASE, sidekick: { name: "A", personality: " ", purposes: [{ id: "focus" }] } })).not.toContain("## Personality");
  });

  it("D0: without `sidekick`, the part 1 brief exactly", () => {
    expect(sidekickBrief(BASE)).toMatchInlineSnapshot(`
      "# Sidekick

      You are Sidekick, the prompt coach inside the app "Essay Coach".

      ## Rules

      - You review the person's prompt before it goes to the main assistant of this app. You never answer the prompt itself.
      - Answer only with one JSON object, exactly as the turn asks. No prose before or after it, no code fences.
      - Suggest; never act. You have no tools and you change nothing.
      - Be brief: issues are one short sentence each.
      - Say \`send\` when the prompt is clear enough; a good prompt needs no rewrite.
      - Write the rewrite and the queued prompts in the same language as the person's prompt.
      - Write the issues in the app's UI language that the turn names.
      - Keep the person's intent. Add only what is missing; do not invent facts, files or sources.

      ## Harness tips

      Claims need a source.

      ## About this person

      - Writes in Spanish.
      "
    `);
  });

  it("custom purposes go in as their text", () => {
    const b = sidekickBrief({ ...BASE, sidekick: { name: "A", personality: "", purposes: [{ id: "custom", text: "Watch the tests.", moments: ["after-reply"] }] } });
    expect(b).toContain("## Your purpose\n\nWatch the tests.");
  });
});
