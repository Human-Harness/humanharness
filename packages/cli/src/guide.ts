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

/** The text between two markers of an AGENTS.md, or null when there is none. */
function between(text: string, startMarker: string, endMarker: string): string | null {
  const agents = text.replace(/\r\n/g, "\n");
  const start = agents.indexOf(`${startMarker}\n`);
  const end = agents.indexOf(endMarker);
  if (start < 0 || end < start) return null;
  return agents.slice(start + startMarker.length + 1, end);
}

/** The guide between the markers of an AGENTS.md, or null when there is none. */
export function guideSection(text: string): string | null {
  return between(text, GUIDE_START, GUIDE_END);
}

// The plugin guide (plugins spec §9.4): the same shape as the harness's, with its own markers, so a folder could hold both.
export const PLUGIN_GUIDE_START = "<!-- humanharness:plugin-guide:start -->";
export const PLUGIN_GUIDE_END = "<!-- humanharness:plugin-guide:end -->";

const PLUGIN_SKILL_DESCRIPTION =
  "Guides the creation of this Human Harness plugin one question at a time (purpose, sources and credentials, data, rules and attention, panel and chip, actions, verify), records each decision in PLUGIN.md and writes the code. Use when the developer runs /new-plugin or asks to create, shape or change this plugin.";

/** `.claude/skills/new-plugin/SKILL.md` in a plugin folder: the guide, unchanged, under the skill's front matter. */
export function pluginSkillFile(guide: string): string {
  return `---\nname: new-plugin\ndescription: ${JSON.stringify(PLUGIN_SKILL_DESCRIPTION)}\n---\n\n${guide}`;
}

/** A plugin folder's `AGENTS.md`: a short intro and the guide, unchanged, between the plugin markers. */
export function pluginAgentsFile(id: string, guide: string): string {
  return [
    `# ${id}`,
    "",
    "This folder is a Human Harness plugin. Its decisions live in `PLUGIN.md`.",
    "",
    "When the developer types /new-plugin or asks to create, shape or change this plugin, follow the guide below.",
    "",
    PLUGIN_GUIDE_START,
    `${guide}${guide.endsWith("\n") ? "" : "\n"}${PLUGIN_GUIDE_END}`,
    "",
  ].join("\n");
}

/** The plugin guide between its markers in an AGENTS.md, or null when there is none. */
export function pluginGuideSection(text: string): string | null {
  return between(text, PLUGIN_GUIDE_START, PLUGIN_GUIDE_END);
}
