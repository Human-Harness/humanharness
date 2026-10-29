import { type Section, parseSections, tableRows } from "./harness-md";

/** The sections of a plugin's PLUGIN.md, in order (plugins spec §9.4, Decision 19). */
export const PLUGIN_SECTIONS = ["Purpose", "Sources", "Rules", "Panels", "Actions", "Permissions", "Decision log"] as const;
export const PLUGIN_MD = "PLUGIN.md";

export interface PluginMdSource {
  id: string;
  /** Seconds; null when the cell isn't a TTL. */
  ttl: number | null;
  line: number;
}

export interface PluginMdPermissions {
  /** Host patterns, lower-cased. */
  hosts: string[];
  /** Each `Runs:` line as `<cmd> <args…>`, single-spaced. */
  exec: string[];
  keys: string[];
  /** A `- Tasks` bullet is there. */
  tasks: boolean;
}

export interface PluginDoc {
  /** By canonical name (any case in the file); the first of two equal headings wins. */
  sections: Map<string, Section>;
  /** The Sources table's rows, or null when the Sources section has no `| Source | Brings | TTL |` table. */
  sources: PluginMdSource[] | null;
  permissions: PluginMdPermissions;
}

const SOURCES_HEADER = /^\|?\s*Source\s*\|\s*Brings\s*\|\s*TTL\s*\|?\s*$/i;
const FENCE = /^\s*(`{3,}|~{3,})/;
/** `- Host: <value> — <reason>` (also `Runs`, `Key`; `—` or `–` before the reason, which may be left out). */
const PERMISSION = /^\s*[-*]\s+(Host|Runs|Key)\s*:\s*(.+?)\s*(?:\s[—–]\s.*)?$/i;
const TASKS = /^\s*[-*]\s+Tasks\s*(?:[—–].*)?$/i;
const TTL = /^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?$/i;
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** A TTL cell in seconds: `300`, `300 s`, `5 min`, `6 h`, `1 d`; null for anything else. */
export function parseTtl(cell: string): number | null {
  const m = TTL.exec(cell.replace(/`/g, "").trim());
  if (!m) return null;
  return Number(m[1]) * UNIT[(m[2] ?? "s")[0].toLowerCase()];
}

const plain = (v: string) => v.replace(/`/g, "").replace(/\s+/g, " ").trim();

function parsePermissions(section: Section | undefined): PluginMdPermissions {
  const out: PluginMdPermissions = { hosts: [], exec: [], keys: [], tasks: false };
  let fence: string | null = null;
  for (const l of section?.lines ?? []) {
    const marker = FENCE.exec(l.text)?.[1];
    if (marker && (fence === null || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === null ? marker : null;
      continue;
    }
    if (fence !== null) continue;
    if (TASKS.test(l.text)) {
      out.tasks = true;
      continue;
    }
    const p = PERMISSION.exec(l.text);
    if (!p) continue;
    const kind = p[1].toLowerCase();
    const value = plain(p[2]);
    if (kind === "host") out.hosts.push(value.toLowerCase());
    else if (kind === "runs") out.exec.push(value);
    else out.keys.push(value);
  }
  return out;
}

/** PLUGIN.md as `check` reads it: the sections, the Sources table and the permission bullets (Decision 19). */
export function parsePluginMd(text: string): PluginDoc {
  const sections = parseSections(text, PLUGIN_SECTIONS);
  const rows = tableRows(sections.get("Sources"), SOURCES_HEADER);
  const sources = rows?.map(({ cells: [id = "", , ttl = ""], line }) => ({ id: plain(id), ttl: parseTtl(ttl), line })) ?? null;
  return { sections, sources, permissions: parsePermissions(sections.get("Permissions")) };
}
