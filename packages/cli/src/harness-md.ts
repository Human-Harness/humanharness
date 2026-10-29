/** The sections of a harness's HARNESS.md, in order (spec §6). */
export const HARNESS_SECTIONS = ["Task", "Decisions", "Flow", "Mechanical work", "Context", "Models", "Permissions and engines", "Identity", "Open questions", "Decision log"] as const;
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

/** A line that starts like a permission (`- edit:`) but isn't in the expected shape. */
export interface MalformedPermission {
  key: PermissionKey;
  text: string;
  line: number;
}

export interface HarnessDoc {
  /** By heading (a known section under its canonical name, whatever its case); the first of two equal headings wins. */
  sections: Map<string, Section>;
  /** The Flow table, or null when the Flow section has no `| Action | Tier | Cost | Purpose |` table. */
  flow: FlowRow[] | null;
  permissions: PermissionLine[];
  malformedPermissions: MalformedPermission[];
  engines: { ids: string[]; line: number } | null;
}

const HEADING = /^##\s+(.+?)\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const PERMISSION_START = /^\s*(?:[-*]\s+)?`?(edit|exec|web)`?\s*:/i;
const FLOW_HEADER = /^\|?\s*Action\s*\|\s*Tier\s*\|\s*Cost\s*\|\s*Purpose\s*\|?\s*$/i;
const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
/** `- edit: none — reason` (also `exec`, `web`; backticks, quotes, `—`, `–`, `--` or `-` before the reason). */
const PERMISSION = /^\s*(?:[-*]\s+)?`?(edit|exec|web)`?\s*:\s*`?"?([A-Za-z]+)"?`?\s*(?:(?:—|–|--|-)\s*(.*?))?\s*$/i;
const ENGINES_LINE = /^\s*(?:[-*]\s+)?`?engines`?\s*:\s*(.+?)\s*$/i;

/** A Markdown table row's cells, trimmed, with a cell's surrounding backticks removed. */
export const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim().replace(/^`(.*)`$/, "$1"));

export function parseHarnessMd(text: string): HarnessDoc {
  const sections = parseSections(text, HARNESS_SECTIONS);
  return { sections, flow: parseFlow(sections.get("Flow")), ...parsePermissions(sections.get("Permissions and engines")) };
}

/**
 * A Markdown file's `## ` sections, outside code fences. A heading in `known` (any case) is keyed by its canonical
 * name, any other by its text; the first of two equal headings wins.
 */
export function parseSections(text: string, known: readonly string[]): Map<string, Section> {
  const sections = new Map<string, Section>();
  const lines = text.split(/\r?\n/);
  let current: Section | null = null;
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = FENCE.exec(lines[i])?.[1];
    if (marker && (fence === null || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence === null ? marker : null;
    const heading = fence === null && !marker ? HEADING.exec(lines[i]) : null;
    if (heading) {
      current = { title: heading[1], line: i + 1, lines: [] };
      const key = known.find((s) => s.toLowerCase() === heading[1].toLowerCase()) ?? heading[1];
      if (!sections.has(key)) sections.set(key, current);
    } else current?.lines.push({ text: lines[i], line: i + 1 });
  }
  return sections;
}

/** The rows under a section's first table whose header line matches `header`; null when there is no such table. */
export function tableRows(section: Section | undefined, header: RegExp): { cells: string[]; line: number }[] | null {
  if (!section) return null;
  const at = section.lines.findIndex((l) => header.test(l.text));
  if (at < 0 || !SEPARATOR.test(section.lines[at + 1]?.text ?? "")) return null;
  const rows: { cells: string[]; line: number }[] = [];
  for (const l of section.lines.slice(at + 2)) {
    if (!l.text.trim().startsWith("|")) break;
    rows.push({ cells: cells(l.text), line: l.line });
  }
  return rows;
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
  return (
    tableRows(section, FLOW_HEADER)?.map(({ cells: [action = "", tier = "", cost = "", purpose = ""], line }) => ({
      action,
      tier: tier.toLowerCase(),
      cost: cost.toLowerCase(),
      purpose,
      line,
    })) ?? null
  );
}

function parsePermissions(section: Section | undefined): Pick<HarnessDoc, "permissions" | "malformedPermissions" | "engines"> {
  const permissions: PermissionLine[] = [];
  const malformedPermissions: MalformedPermission[] = [];
  let engines: HarnessDoc["engines"] = null;
  for (const l of section?.lines ?? []) {
    const p = PERMISSION.exec(l.text);
    if (p) {
      const key = p[1].toLowerCase() as PermissionKey;
      if (!permissions.some((x) => x.key === key)) permissions.push({ key, value: p[2].toLowerCase(), reason: p[3] ?? "", line: l.line });
      continue;
    }
    const start = PERMISSION_START.exec(l.text);
    if (start) {
      malformedPermissions.push({ key: start[1].toLowerCase() as PermissionKey, text: l.text.trim(), line: l.line });
      continue;
    }
    const e = ENGINES_LINE.exec(l.text);
    if (e && !engines) {
      const ids = e[1].split(/[,\s]+/).map((x) => x.replace(/`/g, "").toLowerCase()).filter(Boolean);
      engines = { ids, line: l.line };
    }
  }
  return { permissions, malformedPermissions, engines };
}
