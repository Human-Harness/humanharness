import { promises as fs } from "node:fs";

export const GUIDE_START = "<!-- humanharness:guide:start -->";
export const GUIDE_END = "<!-- humanharness:guide:end -->";

const SKILL_DESCRIPTION =
  "Guides the creation of this Human Harness harness one question at a time (task, decisions, flow, context, models, permissions, identity), records each decision in HARNESS.md and writes the code. Use when the developer runs /new-harness or asks to create, shape or change this harness.";

export const readGuide = (file: string) => fs.readFile(file, "utf8");

/** `.claude/skills/new-harness/SKILL.md` (Claude Code): the guide, unchanged, under the skill's front matter. */
export function skillFile(guide: string): string {
  return `---\nname: new-harness\ndescription: ${JSON.stringify(SKILL_DESCRIPTION)}\n---\n\n${guide}`;
}

/** The harness repo's `AGENTS.md` (Codex): a short intro and the guide, unchanged, between markers. */
export function agentsFile(id: string, guide: string): string {
  return [
    `# ${id}`,
    "",
    "This repository is a Human Harness harness. Its decisions live in `HARNESS.md`.",
    "",
    "When the developer types /new-harness or asks to create, shape or change this harness, follow the guide below.",
    "",
    GUIDE_START,
    `${guide}${guide.endsWith("\n") ? "" : "\n"}${GUIDE_END}`,
    "",
  ].join("\n");
}

/** The guide between the markers of an AGENTS.md, or null when there is none. */
export function guideSection(text: string): string | null {
  const agents = text.replace(/\r\n/g, "\n");
  const start = agents.indexOf(`${GUIDE_START}\n`);
  const end = agents.indexOf(GUIDE_END);
  if (start < 0 || end < start) return null;
  return agents.slice(start + GUIDE_START.length + 1, end);
}
