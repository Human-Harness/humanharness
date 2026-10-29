// Flat YAML frontmatter for a scope's SKILL.md and agents/*.md (plan Decision 4: no YAML
// dependency). Only `key: value`, `key: [a, b]` and `key: |` blocks; anything else is refused
// naming the key, so a file the parser can't read never reaches an engine half-understood.

export type FrontmatterValue = string | string[];
export type Frontmatter = { fields: Record<string, FrontmatterValue>; body: string };

const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const PLAIN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_BYTES = 256 * 1024;
// A lone \r, U+2028/U+2029 and NEL are line breaks to a YAML parser but not to this one: a key
// hidden behind one would pass the checks here and still load in the engine. Refuse every
// control character but \t (a trailing \r of CRLF is stripped first), plus U+2028, U+2029, U+FEFF.
const UNSAFE_CHAR = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029\uFEFF]/;

function unquote(raw: string, key: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\n])/g, (_m, c: string) => (c === "n" ? "\n" : c));
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') || v.startsWith("'")) throw new Error(`frontmatter: ${key} has an unclosed quote`);
  return v;
}

/** `[a, "b, c"]` → ["a", "b, c"]: commas inside quotes don't split. */
function parseList(raw: string, key: string): string[] {
  const inner = raw.slice(1, -1);
  if (inner.trim() === "") return [];
  const items: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      items.push(cur);
      cur = "";
    } else if (ch === "[" || ch === "]" || ch === "{" || ch === "}") {
      throw new Error(`frontmatter: ${key} must be a flat list`);
    } else cur += ch;
  }
  if (quote) throw new Error(`frontmatter: ${key} has an unclosed quote`);
  items.push(cur);
  return items.map((item) => {
    const v = unquote(item, key);
    if (v === "") throw new Error(`frontmatter: ${key} has an empty item`);
    return v;
  });
}

/** Splits `---` frontmatter from the body. No leading `---` line: no fields, the whole text is the body. */
export function parseFrontmatter(text: string): Frontmatter {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("frontmatter: the file is over 256 KB");
  const lines = text.split("\n");
  const first = lines[0].replace(/\r$/, "");
  if (first !== "---") {
    // "--- ", "\uFEFF---" or "---\r..." may open frontmatter for another parser: never read
    // such a file as "no frontmatter" (that would skip the key checks).
    if (/^[\s\uFEFF]*---/.test(first)) throw new Error("frontmatter: the opening line must be exactly ---");
    return { fields: {}, body: text };
  }
  const close = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, "") === "---");
  if (close < 0) throw new Error("frontmatter: no closing --- line");
  const head = lines.slice(1, close).map((l) => l.replace(/\r$/, ""));
  head.forEach((line, n) => {
    if (!UNSAFE_CHAR.test(line)) return;
    const key = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)?.[1];
    throw new Error(`frontmatter: ${key ?? `line ${n + 2}`} has a control or line-break character`);
  });
  const body = lines.slice(close + 1).join("\n");

  const fields: Record<string, FrontmatterValue> = {};
  let i = 0;
  let lastKey: string | null = null;
  while (i < head.length) {
    const line = head[i];
    i++;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) throw new Error(`frontmatter: ${lastKey ?? line.trim()} must be flat (indented line)`);
    const colon = line.indexOf(":");
    const key = colon < 0 ? line.trim() : line.slice(0, colon).trim();
    if (colon < 0 || !KEY.test(key)) throw new Error(`frontmatter: "${line.trim()}" is not a key: value line`);
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`frontmatter: ${key} is not allowed`);
    if (Object.hasOwn(fields, key)) throw new Error(`frontmatter: ${key} appears twice`);
    lastKey = key;
    const raw = line.slice(colon + 1).trim();
    let value: FrontmatterValue;
    if (raw === "|" || raw === "|-") {
      const block: string[] = [];
      while (i < head.length && (head[i].trim() === "" || /^\s/.test(head[i]))) block.push(head[i++]);
      while (block.length && block[block.length - 1].trim() === "") block.pop();
      let indent = Infinity;
      for (const l of block) if (l.trim() !== "") indent = Math.min(indent, l.length - l.trimStart().length);
      value = block.map((l) => l.slice(indent)).join("\n");
    } else if (raw.startsWith("[")) {
      if (!raw.endsWith("]")) throw new Error(`frontmatter: ${key} has an unclosed list`);
      value = parseList(raw, key);
    } else if (/^[{&*!>%@`]/.test(raw)) {
      throw new Error(`frontmatter: ${key} must be a plain value, a [list] or a | block`);
    } else {
      value = unquote(raw, key);
    }
    fields[key] = value;
  }
  return { fields, body };
}

/** The fields Claude's `--agents` JSON takes from a scope's agent file (spec §5.2). */
export type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: FrontmatterValue;
  disallowedTools?: FrontmatterValue;
  model?: string;
  color?: string;
  skills?: FrontmatterValue;
  memory?: string;
};

const AGENT_KEPT = ["tools", "disallowedTools", "model", "color", "skills", "memory"] as const;
const AGENT_LIST_OK = new Set(["tools", "disallowedTools", "skills"]);
/** Dropped and shown as "ignored" (E6): a scope can't pick the agent's permission mode. */
const AGENT_IGNORED = new Set(["permissionMode"]);
/** `user` memory lives in the person's own Claude config, outside the folder: a scope agent may only use the folder's. */
const AGENT_MEMORY = new Set(["project", "local"]);

function parseIn(where: string, text: string): Frontmatter {
  try {
    return parseFrontmatter(text);
  } catch (err) {
    throw new Error(`${where}: ${(err as Error).message}`);
  }
}

function descriptionOf(where: string, fields: Record<string, FrontmatterValue>): string {
  const d = fields.description;
  if (typeof d !== "string" || d.trim() === "") throw new Error(`${where}: description is required`);
  return d;
}

/**
 * `agents/<file>.md` → one entry of the `--agents` JSON: frontmatter as fields, body as `prompt`.
 * `hooks`, `mcpServers` and any unknown key are refused naming it (Decision 6, E6).
 */
export function agentFromMarkdown(
  file: string,
  text: string,
): { name: string; agent: AgentDefinition; ignored: string[] } {
  const where = `agents/${file}`;
  const { fields, body } = parseIn(where, text);
  const ignored: string[] = [];
  for (const key of Object.keys(fields)) {
    if (AGENT_IGNORED.has(key)) ignored.push(key);
    else if (key !== "name" && key !== "description" && !(AGENT_KEPT as readonly string[]).includes(key)) {
      throw new Error(`${where}: ${key} is not allowed`);
    }
  }
  const name = fields.name ?? (file.endsWith(".md") ? file.slice(0, -3) : "");
  if (typeof name !== "string" || !PLAIN_ID.test(name)) {
    throw new Error(`${where}: the name must be a plain id (a-z, 0-9, -)`);
  }
  const agent: AgentDefinition = { description: descriptionOf(where, fields), prompt: body.trim() };
  for (const key of AGENT_KEPT) {
    const v = fields[key];
    if (v === undefined) continue;
    if (Array.isArray(v) && !AGENT_LIST_OK.has(key)) throw new Error(`${where}: ${key} must be a single value`);
    if (key === "memory" && !AGENT_MEMORY.has(v as string)) throw new Error(`${where}: memory ${String(v)} is not allowed`);
    (agent as Record<string, FrontmatterValue>)[key] = v;
  }
  return { name, agent, ignored };
}

/**
 * `skills/<dir>/SKILL.md`: the file is copied as is into the snapshot; this only reads its
 * name and description for the approval screen and refuses `hooks` (E6).
 */
export function skillFromMarkdown(dir: string, text: string): { name: string; description: string } {
  const where = `skills/${dir}/SKILL.md`;
  const { fields } = parseIn(where, text);
  if (Object.hasOwn(fields, "hooks")) throw new Error(`${where}: hooks is not allowed`);
  if (!PLAIN_ID.test(dir)) throw new Error(`${where}: the name must be a plain id (a-z, 0-9, -)`);
  if (fields.name !== undefined && fields.name !== dir) {
    throw new Error(`${where}: the name must match the folder (${dir})`);
  }
  return { name: dir, description: descriptionOf(where, fields) };
}
