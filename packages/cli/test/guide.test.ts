import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentsFile, guideSection, PLUGIN_GUIDE_END, PLUGIN_GUIDE_START, pluginAgentsFile, pluginGuideSection, pluginSkillFile, skillFile } from "../src/guide";
import { HARNESS_SECTIONS } from "../src/harness-md";
import { pluginGuideFileOf, pluginTemplateDirOf } from "../src/paths";
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

  it("asks about scopes and data in the Context phase", () => {
    const context = phases(guide).find((p) => p.name === "Context")!;
    for (const word of ["`scopes`", '`scope: "none"`', "`data`", "`agent`", "`context`", "`rules`"]) expect(context.body).toContain(word);
  });

  it("asks about settings in the Context phase", () => {
    const context = phases(guide).find((p) => p.name === "Context")!;
    for (const word of ["`settings`", "`default`", "`control`", "{{value}}", "{{value:label}}", "`onlyWhenChanged: true`", "--set name=value"]) expect(context.body).toContain(word);
  });

  it("asks about task modes in the Flow phase", () => {
    const flow = phases(guide).find((p) => p.name === "Flow")!;
    for (const word of ["`modes`", "`defaultMode`", "`recommend`", "`ask`", "`minTier`", "`recommend_mode`", "--mode <id>", "docs/architecture/modes.md"]) expect(flow.body).toContain(word);
  });

  it("asks about background jobs in the Flow phase", () => {
    const flow = phases(guide).find((p) => p.name === "Flow")!;
    for (const word of ["`jobs`", "`afterTask`", "`every`", "`dailyTokens`", "`job_result`", '`tier: "light"`', '`permissions: { edit: "none" }`', "docs/architecture/jobs.md"]) {
      expect(flow.body).toContain(word);
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

describe("the harness guide helpers (D0: unchanged by the plugin guide)", () => {
  // Output taken before the plugin guide's helpers were added; any change here changes every harness `init` writes.
  const g = "# G\n\nBody line.\n";
  it("write the skill file byte for byte as before", () => {
    expect(skillFile(g)).toBe(
      '---\nname: new-harness\ndescription: "Guides the creation of this Human Harness harness one question at a time (task, decisions, flow, context, models, permissions, identity), records each decision in HARNESS.md and writes the code. Use when the developer runs /new-harness or asks to create, shape or change this harness."\n---\n\n# G\n\nBody line.\n',
    );
  });
  it("write AGENTS.md and read the section back byte for byte as before", () => {
    const head = "# h\n\nThis repository is a Human Harness harness. Its decisions live in `HARNESS.md`.\n\nWhen the developer types /new-harness or asks to create, shape or change this harness, follow the guide below.\n\n";
    expect(agentsFile("h", g)).toBe(`${head}<!-- humanharness:guide:start -->\n# G\n\nBody line.\n<!-- humanharness:guide:end -->\n`);
    expect(agentsFile("h", "no newline")).toBe(`${head}<!-- humanharness:guide:start -->\nno newline\n<!-- humanharness:guide:end -->\n`);
    expect(guideSection(agentsFile("h", g))).toBe(g);
  });
  it("don't read a plugin guide section as the harness guide, nor the other way round", () => {
    expect(guideSection(pluginAgentsFile("p", g))).toBeNull();
    expect(pluginGuideSection(agentsFile("h", g))).toBeNull();
  });
});

const PLUGIN_PHASES = ["Purpose", "Sources and credentials", "Data", "Rules and attention", "Panel and chip", "Actions", "Verify"];

/** Each `## N. Name` with its body (up to the next `## `). */
function pluginPhases(text: string): { n: number; name: string; body: string }[] {
  return text
    .split(/^## /m)
    .slice(1)
    .flatMap((p) => {
      const m = /^(\d+)\. (.+)\n([\s\S]*)$/.exec(p);
      return m ? [{ n: Number(m[1]), name: m[2].trim(), body: m[3] }] : [];
    });
}

describe("the /new-plugin guide", () => {
  const file = () => read(path.join(CORE, "packages", "cli", "guide"), "new-plugin.md");

  it("lives where init reads it, next to the plugin template", () => {
    expect(pluginGuideFileOf(CORE)).toBe(path.join(CORE, "packages", "cli", "guide", "new-plugin.md"));
    expect(pluginTemplateDirOf(CORE)).toBe(path.join(CORE, "packages", "cli", "plugin-template"));
  });

  it("runs the seven phases in order", () => {
    expect(pluginPhases(file()).map((p) => [p.n, p.name])).toEqual(PLUGIN_PHASES.map((name, i) => [i + 1, name]));
  });

  it("ends every phase by updating PLUGIN.md together with the code", () => {
    for (const p of pluginPhases(file())) expect(p.body, `phase ${p.n}`).toMatch(/^Fills: PLUGIN\.md → .+$/m);
  });

  it("starts from PLUGIN.md on an existing plugin and asks one question at a time", () => {
    const g = file();
    expect(g).toMatch(/one question at a time/i);
    expect(g).toContain("Read `PLUGIN.md` first");
  });

  it("states the rules an author can't bend", () => {
    const g = file();
    for (const rule of ["Never call `fetch`", "Declare every host", "`{{secret:<id>}}`", "never write without asking"]) expect(g).toContain(rule);
    expect(g).toContain("Settings › Plugins");
  });

  it("never asks for a key's value: the person types keys themselves", () => {
    const sources = pluginPhases(file()).find((p) => p.name === "Sources and credentials")!;
    expect(sources.body).toMatch(/Never ask for a key's value/);
  });

  it("can't skip Verify: record, check, test, then dev showing the panel", () => {
    const verify = pluginPhases(file()).find((p) => p.name === "Verify")!;
    expect(verify.body).toMatch(/can't be skipped/i);
    const order = ["humanharness plugin record", "humanharness plugin check", "humanharness plugin test", "humanharness plugin dev --harness"].map((c) => verify.body.indexOf(c));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("names no engine's home folder and never sends the agent to engine config", () => {
    const g = file();
    expect(g).not.toMatch(/~\/\.(claude|codex|gemini)|\.config\/opencode|\.local\/share\/opencode/);
    // The "stay out" rule names them by folder, as new-harness.md does, without a home path.
    const rule = g.split("\n").find((l) => l.includes("Stay out of the AI engines' own folders"));
    for (const dir of ["`.claude`", "`.codex`", "`.gemini`", "OpenCode"]) expect(rule).toContain(dir);
    expect(g).not.toMatch(/\b(read|open|check|look at)\b[^.\n]*\b(engine|claude|codex|gemini|opencode)\b[^.\n]*\b(config|settings|credentials?|tokens?)\b/i);
  });

  it("generates SKILL.md and the AGENTS.md section from the source, unchanged", () => {
    const g = file();
    const skill = pluginSkillFile(g);
    const m = /^---\nname: new-plugin\ndescription: (".+")\n---\n\n/.exec(skill);
    expect(m).not.toBeNull();
    const description = JSON.parse(m![1]) as string;
    expect(description).toContain("/new-plugin");
    expect(description).toContain("PLUGIN.md");
    expect(skill.slice(m![0].length)).toBe(g);
    const agents = pluginAgentsFile("on-call", g);
    expect(agents).toMatch(/^# on-call\n/);
    expect(agents).toContain("`PLUGIN.md`");
    expect(agents).toContain(`${PLUGIN_GUIDE_START}\n`);
    expect(agents.trimEnd().endsWith(PLUGIN_GUIDE_END)).toBe(true);
    expect(pluginGuideSection(agents)).toBe(g);
    expect(pluginGuideSection(agents.replace(/\n/g, "\r\n"))).toBe(g);
    expect(pluginGuideSection(pluginAgentsFile("x", "no newline"))).toBe("no newline\n");
    expect(pluginGuideSection("# x\nno guide here\n")).toBeNull();
  });
});
