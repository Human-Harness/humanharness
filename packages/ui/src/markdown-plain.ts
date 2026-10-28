import { plainCitations } from "./citations";

/**
 * The chat's screen-reader text (`markdownToPlain`), with the line parser it always used. Kept as it was when the
 * rich renderer replaced the drawing (document-reader spec §3.1): the announcement must not change.
 */

type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; text: Inline[]; url: string };

type Block =
  | { t: "p"; lines: string[] }
  | { t: "h"; text: string }
  | { t: "ul"; items: string[][] }
  | { t: "ol"; start: number; items: string[][] }
  | { t: "pre"; text: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] | null = null;
  let list: Extract<Block, { t: "ul" | "ol" }> | null = null;
  const end = () => {
    para = null;
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      end();
      const body: string[] = [];
      const close = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ t: "pre", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      end();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      end();
      blocks.push({ t: "h", text: heading[1] });
      continue;
    }
    if (RULE.test(line)) {
      end();
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      para = null;
      const kind = bullet ? "ul" : "ol";
      const item = bullet ? bullet[1] : ordered![2];
      const current = list as Extract<Block, { t: "ul" | "ol" }> | null;
      if (current && current.t === kind) current.items.push([item]);
      else {
        list = bullet ? { t: "ul", items: [[item]] } : { t: "ol", start: Number(ordered![1]), items: [[item]] };
        blocks.push(list);
      }
      continue;
    }
    const openList = list as Extract<Block, { t: "ul" | "ol" }> | null;
    if (openList && /^\s/.test(line)) {
      // An indented line continues the last item.
      openList.items[openList.items.length - 1].push(line.trim());
      continue;
    }
    list = null;
    if (para) (para as string[]).push(line);
    else {
      para = [line];
      blocks.push({ t: "p", lines: para });
    }
  }
  return blocks;
}

// Order matters: code spans first (nothing inside them is Markdown), then links, bold, italics.
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)|(?<!\w)__(?=\S)([\s\S]*?\S)__(?!\w)|\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)|(?<!\w)_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: "code", v: m[2].replace(/^ (.*) $/, "$1") });
    else if (m[3] !== undefined) out.push({ t: "link", text: parseInline(m[3]), url: m[4] });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ t: "strong", c: parseInline(m[5] ?? m[6]) });
    else out.push({ t: "em", c: parseInline(m[7] ?? m[8]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

function plainInline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "strong":
        case "em":
          return plainInline(n.c);
        case "link": {
          const label = plainInline(n.text);
          return label === n.url ? label : `${label} (${n.url})`;
        }
      }
    })
    .join("");
}

/**
 * The same text without Markdown marks, for screen readers. Citations `[[frag:<id>]]` (outside code blocks) are read
 * as their label when `cite` knows it, else left out (material spec §9).
 */
export function markdownToPlain(text: string, cite?: (id: string) => string | undefined): string {
  return parseBlocks(text)
    .map((b) => {
      switch (b.t) {
        case "p":
          return plainCitations(b.lines.map((l) => plainInline(parseInline(l))).join("\n"), cite);
        case "h":
          return plainCitations(plainInline(parseInline(b.text)), cite);
        case "ul":
          return plainCitations(b.items.map((item) => item.map((l) => plainInline(parseInline(l))).join("\n")).join("\n"), cite);
        case "ol":
          return plainCitations(b.items.map((item, j) => `${b.start + j}. ${item.map((l) => plainInline(parseInline(l))).join("\n")}`).join("\n"), cite);
        case "pre":
          return b.text;
      }
    })
    .join("\n\n");
}
