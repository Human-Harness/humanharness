import path from "node:path";
import { describe, expect, it } from "vitest";
import { HARNESS_SECTIONS, QUESTIONS_ROW, parseHarnessMd, sectionText } from "../src/harness-md";
import { CORE, read } from "./helpers";

const sample = [
  "# x", //                                        1
  "",
  "## Flow", //                                    3
  "",
  "<!-- c -->",
  "",
  "|  Action | Tier |Cost| Purpose |", //          7
  "|---|---|---|---|",
  "| `research`  |  Deep | heavy | Digs in |", //  9
  "| (questions) | light | – | Free questions |", // 10
  "",
  "After the table.",
  "",
  "## Permissions and engines", //                 14
  "",
  "- edit: folder — writes the plan", //            16
  "- `exec`: false",
  "- web: true -- looks up prices",
  "- engines: claude, `codex`", //                  19
  "",
  "## Open questions", //                          21
  "",
  "<!-- none yet",
  "     still none -->",
  "",
].join("\n");

describe("parseHarnessMd", () => {
  it("reads the Flow table: spaces, backticks and case don't matter; (questions) is a row", () => {
    const doc = parseHarnessMd(sample);
    expect(doc.flow).toEqual([
      { action: "research", tier: "deep", cost: "heavy", purpose: "Digs in", line: 9 },
      { action: QUESTIONS_ROW, tier: "light", cost: "–", purpose: "Free questions", line: 10 },
    ]);
  });

  it("reads one line per permission with its reason, and the engines", () => {
    const doc = parseHarnessMd(sample);
    expect(doc.permissions).toEqual([
      { key: "edit", value: "folder", reason: "writes the plan", line: 16 },
      { key: "exec", value: "false", reason: "", line: 17 },
      { key: "web", value: "true", reason: "looks up prices", line: 18 },
    ]);
    expect(doc.engines).toEqual({ ids: ["claude", "codex"], line: 19 });
  });

  it("keeps sections by heading; a section of comments only reads as empty", () => {
    const doc = parseHarnessMd(sample);
    expect([...doc.sections.keys()]).toEqual(["Flow", "Permissions and engines", "Open questions"]);
    expect(doc.sections.get("Open questions")?.line).toBe(21);
    expect(sectionText(doc.sections.get("Open questions"))).toBe("");
    expect(sectionText(doc.sections.get("Flow"))).toContain("After the table.");
    expect(sectionText(undefined)).toBe("");
  });

  it("has no Flow table without its header and separator rows", () => {
    expect(parseHarnessMd("## Flow\n\n| Action | Tier |\n|---|---|\n| a | light |\n").flow).toBeNull();
    expect(parseHarnessMd("## Flow\n\n| Action | Tier | Cost | Purpose |\n| a | light | light | x |\n").flow).toBeNull();
    expect(parseHarnessMd("## Context\n\nNothing.\n").flow).toBeNull();
  });

  it("an empty table has no rows; a missing permission or engines line is simply absent", () => {
    const doc = parseHarnessMd("## Flow\n\n| Action | Tier | Cost | Purpose |\n|---|---|---|---|\n\n## Permissions and engines\n\n- edit: none\n");
    expect(doc.flow).toEqual([]);
    expect(doc.permissions.map((p) => p.key)).toEqual(["edit"]);
    expect(doc.engines).toBeNull();
  });

  it("reads the template's skeleton: every section, its table and its permission lines", () => {
    const doc = parseHarnessMd(read(path.join(CORE, "packages", "cli", "template"), "HARNESS.md"));
    expect([...doc.sections.keys()]).toEqual([...HARNESS_SECTIONS]);
    expect(doc.flow?.map((r) => [r.action, r.tier, r.cost])).toEqual([["example", "standard", "light"], [QUESTIONS_ROW, "light", "–"]]);
    expect(doc.permissions.map((p) => [p.key, p.value])).toEqual([["edit", "none"], ["exec", "false"], ["web", "false"]]);
    expect(doc.engines?.ids).toEqual(["claude", "codex"]);
  });
});
