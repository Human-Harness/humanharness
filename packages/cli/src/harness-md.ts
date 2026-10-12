/** The sections of a harness's HARNESS.md, in order (spec §6). */
export const HARNESS_SECTIONS = ["Task", "Decisions", "Flow", "Context", "Models", "Permissions and engines", "Identity", "Open questions", "Decision log"] as const;
export type HarnessSection = (typeof HARNESS_SECTIONS)[number];

/** The Flow table's row for free questions. */
export const QUESTIONS_ROW = "(questions)";
export const PERMISSION_KEYS = ["edit", "exec", "web"] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface Section {
  title: string;
  /** 1-based line of the `## ` heading. */
  line: number;
  lines: { text: string; line: number }[];
}

export interface FlowRow {
  action: string;
  tier: string;
  cost: string;
  purpose: string;
  line: number;
}

export interface PermissionLine {
  key: PermissionKey;
  value: string;
  /** The text after the dash; empty when there is none. */
  reason: string;
  line: number;
}

export interface HarnessDoc {
  /** By heading; the first of two equal headings wins. */
  sections: Map<string, Section>;
  /** The Flow table, or null when the Flow section has no `| Action | Tier | Cost | Purpose |` table. */
  flow: FlowRow[] | null;
  permissions: PermissionLine[];
  engines: { ids: string[]; line: number } | null;
}

const HEADING = /^##\s+(.+?)\s*$/;
const FLOW_HEADER = /^\|?\s*Action\s*\|\s*Tier\s*\|\s*Cost\s*\|\s*Purpose\s*\|?\s*$/i;
const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
/** `- edit: none — reason` (also `exec`, `web`; backticks, quotes, `—`, `–`, `--` or `-` before the reason). */
const PERMISSION = /^\s*(?:[-*]\s+)?`?(edit|exec|web)`?\s*:\s*`?"?([A-Za-z]+)"?`?\s*(?:(?:—|–|--|-)\s*(.*?))?\s*$/i;
const ENGINES_LINE = /^\s*(?:[-*]\s+)?`?engines`?\s*:\s*(.+?)\s*$/i;

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim().replace(/^`(.*)`$/, "$1"));

export function parseHarnessMd(text: string): HarnessDoc {
  const sections = new Map<string, Section>();
  const lines = text.split(/\r?\n/);
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i]);
    if (heading) {
      current = { title: heading[1], line: i + 1, lines: [] };
      if (!sections.has(heading[1])) sections.set(heading[1], current);
    } else current?.lines.push({ text: lines[i], line: i + 1 });
  }
  return { sections, flow: parseFlow(sections.get("Flow")), ...parsePermissions(sections.get("Permissions and engines")) };
}

/** A section's text without HTML comments, trimmed: "" means the section is empty. */
export function sectionText(section: Section | undefined): string {
  if (!section) return "";
  return section.lines
    .map((l) => l.text)
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function parseFlow(section: Section | undefined): FlowRow[] | null {
  if (!section) return null;
  const header = section.lines.findIndex((l) => FLOW_HEADER.test(l.text));
  if (header < 0 || !SEPARATOR.test(section.lines[header + 1]?.text ?? "")) return null;
  const rows: FlowRow[] = [];
  for (const l of section.lines.slice(header + 2)) {
    if (!l.text.trim().startsWith("|")) break;
    const [action = "", tier = "", cost = "", purpose = ""] = cells(l.text);
    rows.push({ action, tier: tier.toLowerCase(), cost: cost.toLowerCase(), purpose, line: l.line });
  }
  return rows;
}

function parsePermissions(section: Section | undefined): Pick<HarnessDoc, "permissions" | "engines"> {
  const permissions: PermissionLine[] = [];
  let engines: HarnessDoc["engines"] = null;
  for (const l of section?.lines ?? []) {
    const p = PERMISSION.exec(l.text);
    if (p) {
      const key = p[1].toLowerCase() as PermissionKey;
      if (!permissions.some((x) => x.key === key)) permissions.push({ key, value: p[2].toLowerCase(), reason: p[3] ?? "", line: l.line });
      continue;
    }
    const e = ENGINES_LINE.exec(l.text);
    if (e && !engines) {
      const ids = e[1].split(/[,\s]+/).map((x) => x.replace(/`/g, "").toLowerCase()).filter(Boolean);
      engines = { ids, line: l.line };
    }
  }
  return { permissions, engines };
}
