import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentsFile, guideSection, skillFile } from "../src/guide";
import { HARNESS_SECTIONS } from "../src/harness-md";
import { CORE, read } from "./helpers";

const guide = read(path.join(CORE, "packages", "cli", "guide"), "new-harness.md");
const PHASES = ["Task", "Decisions", "Flow", "Context", "Models", "Permissions and engines", "Identity", "Verify"];

/** Each `## Phase N — Name` with its body (up to the next `## `). */
function phases(text: string): { n: number; name: string; body: string }[] {
  const parts = text.split(/^## /m).slice(1);
  return parts.flatMap((p) => {
    const m = /^Phase (\d+) — (.+)\n([\s\S]*)$/.exec(p);
    return m ? [{ n: Number(m[1]), name: m[2].trim(), body: m[3] }] : [];
  });
}

describe("the /new-harness guide", () => {
  it("runs the eight phases in order", () => {
    expect(phases(guide).map((p) => [p.n, p.name])).toEqual(PHASES.map((name, i) => [i + 1, name]));
  });

  it("names, in every phase, the HARNESS.md sections it fills", () => {
    for (const p of phases(guide)) {
      const fills = /^Fills: HARNESS\.md → (.+)$/m.exec(p.body);
      expect(fills, `phase ${p.n} has no "Fills:" line`).not.toBeNull();
      for (const section of fills![1].split(", ")) expect(HARNESS_SECTIONS as readonly string[]).toContain(section);
    }
  });

  it("states the compliance rules and the check loop", () => {
    for (const dir of ["~/.claude", "~/.codex", "~/.gemini"]) expect(guide).toContain(dir);
    expect(guide).toContain("Never edit files outside this repository");
    expect(guide).toContain("corepack pnpm check");
    expect(guide).toContain("<core>/harnesses/demo");
    expect(guide).toContain("<core>/docs/architecture/");
  });

  it("generates SKILL.md and the AGENTS.md section from the source, unchanged", () => {
    const skill = skillFile(guide);
    expect(skill).toMatch(/^---\nname: new-harness\ndescription: ".+"\n---\n\n/);
    expect(skill.endsWith(guide)).toBe(true);
    expect(skill.slice(skill.indexOf("\n---\n\n") + 6)).toBe(guide);
    const agents = agentsFile("my-harness", guide);
    expect(agents).toMatch(/^# my-harness\n/);
    expect(guideSection(agents)).toBe(guide);
    expect(guideSection("# x\nno guide here\n")).toBeNull();
    expect(guideSection(agents.replace(/\n/g, "\r\n"))).toBe(guide);
  });

  it("asks the developer before running a real task, since it uses their plan", () => {
    const verify = phases(guide).find((p) => p.name === "Verify")!;
    expect(verify.body).toMatch(/ask the developer/i);
  });
});
