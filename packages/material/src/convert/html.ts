import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { fenced, plainLine, withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";

/** Never read: they hold code, chrome or inputs, not the material (Conventions: files are untrusted). */
const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "SVG", "CANVAS", "TEMPLATE", "HEAD"]);
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const BLOCKS = new Set(["P", "BLOCKQUOTE", "DD", "DT", "FIGCAPTION", "CAPTION", "ADDRESS"]);
const INLINE = new Set(["SPAN", "A", "STRONG", "B", "EM", "I", "CODE", "SUB", "SUP", "SMALL", "U", "MARK", "BR", "ABBR", "CITE", "Q", "S", "DEL", "INS", "KBD", "VAR", "SAMP", "TIME", "FONT", "LABEL"]);
const LISTS = ["UL", "OL"];

/** The few DOM members the walker reads (linkedom's nodes, without depending on the DOM lib's types). */
interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes?: ArrayLike<DomNode>;
  parentNode?: DomNode | null;
  querySelectorAll?(s: string): ArrayLike<DomNode>;
}

const squash = (s: string) => s.replace(/\s+/g, " ");
const tagOf = (n: DomNode) => n.nodeName.toUpperCase();
const kids = (n: DomNode) => Array.from(n.childNodes ?? []);

/** Inline Markdown of an element: bold, italics, code, line breaks; links keep their text; images are placeholders. */
function inline(node: DomNode, image: () => void): string {
  if (node.nodeType === 3) return squash(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const tag = tagOf(node);
  if (DROP.has(tag)) return "";
  if (tag === "BR") return "\n";
  if (tag === "IMG") return void image(), "";
  const inner = kids(node).map((c) => inline(c, image)).join("");
  if (!inner.trim()) return inner;
  if (tag === "STRONG" || tag === "B") return `**${inner.trim()}**`;
  if (tag === "EM" || tag === "I") return `*${inner.trim()}*`;
  if (tag === "CODE") return `\`${inner.trim()}\``;
  return inner;
}

function listMd(el: DomNode, depth: number, image: () => void): string {
  const ordered = tagOf(el) === "OL";
  let n = 0;
  const lines: string[] = [];
  for (const li of kids(el)) {
    if (tagOf(li) !== "LI") continue;
    n++;
    const own = kids(li).filter((c) => !LISTS.includes(tagOf(c)));
    const text = squash(own.map((c) => inline(c, image)).join("")).trim();
    lines.push(`${"  ".repeat(depth)}${ordered ? `${n}.` : "-"} ${text}`);
    for (const sub of kids(li)) if (LISTS.includes(tagOf(sub))) lines.push(listMd(sub, depth + 1, image));
  }
  return lines.filter(Boolean).join("\n");
}

function tableMd(el: DomNode, image: () => void): string {
  // Only this table's own rows: a nested table's rows are read inside its cell.
  const ownTable = (tr: DomNode) => {
    let p = tr.parentNode;
    while (p && tagOf(p) !== "TABLE") p = p.parentNode;
    return p === el;
  };
  const rows = Array.from(el.querySelectorAll?.("tr") ?? [])
    .filter(ownTable)
    .map((tr) =>
      kids(tr)
        .filter((c) => ["TD", "TH"].includes(tagOf(c)))
        .map((c) => squash(inline(c, image)).trim().replace(/\|/g, "\\|")),
    )
    .filter((r) => r.length > 0);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${[...r, ...Array<string>(width - r.length).fill("")].join(" | ")} |`;
  return [line(rows[0]), `|${Array(width).fill("---").join("|")}|`, ...rows.slice(1).map(line)].join("\n");
}

/**
 * HTML into blocks. Locations are the heading path and the block's number under its heading (§3 Word: "heading path +
 * paragraph number"): `§ Fractions › Table ¶2`, after `prefix` when one is given (`ch. 2`). Pages are estimated.
 * An image is a block of its own, numbered like one, right after the block it sat in.
 */
export function htmlBlocks(html: string, opts: { prefix?: string } = {}): MdBlock[] {
  const wrapped = () => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
  let doc = /<body[\s>]/i.test(html) ? parseHTML(html).document : wrapped();
  // A `<body` inside a comment or a script string is not a real one: read the fragment wrapped, never nothing.
  if (kids(doc.body as unknown as DomNode).length === 0 && html.trim()) doc = wrapped();
  const out: MdBlock[] = [];
  // The current heading at each level (index = level - 1); a skipped level stays empty.
  const heads: (string | undefined)[] = [];
  let n = 0;
  let images = 0;
  const where = () => {
    const path = heads.filter((h): h is string => !!h);
    return [opts.prefix, path.length ? `§ ${path.join(" › ")}` : ""].filter(Boolean).join(" › ");
  };
  const numbered = () => [where(), `¶${n}`].filter(Boolean).join(" ");
  const emitImages = () => {
    for (; images > 0; images--) {
      n++;
      out.push({ kind: "image", md: `[image, ${numbered()}]`, loc: numbered(), page: 1 });
    }
  };
  const image = () => void images++;
  const add = (kind: Exclude<MdBlock["kind"], "heading" | "image">, md: string) => {
    if (md.trim()) {
      n++;
      out.push({ kind, md, loc: numbered(), page: 1 });
    }
    emitImages();
  };
  let loose = "";
  const flush = () => {
    const text = loose.split("\n").map((l) => plainLine(squash(l).trim())).filter(Boolean).join("\n");
    loose = "";
    add("para", text);
  };
  const walk = (node: DomNode) => {
    if (node.nodeType === 3) {
      loose += squash(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = tagOf(node);
    if (DROP.has(tag)) return;
    if (Object.hasOwn(HEADINGS, tag)) {
      flush();
      const level = HEADINGS[tag];
      const text = squash(inline(node, () => {})).trim();
      if (!text) return;
      heads.length = level - 1;
      heads[level - 1] = text;
      n = 0;
      out.push({ kind: "heading", level, md: `${"#".repeat(level)} ${text}`, loc: where(), page: 1 });
      return;
    }
    if (LISTS.includes(tag)) return void (flush(), add("list", listMd(node, 0, image)));
    if (tag === "TABLE") return void (flush(), add("table", tableMd(node, image)));
    if (tag === "PRE") {
      // HTML drops one newline right after `<pre>`.
      const code = (node.textContent ?? "").replace(/^\r?\n/, "");
      return void (flush(), add("code", code.trim() ? fenced(code) : ""));
    }
    if (tag === "IMG") return void (flush(), image(), emitImages());
    if (tag === "HR") return void flush();
    if (BLOCKS.has(tag)) {
      flush();
      const text = inline(node, image).split("\n").map((l) => plainLine(squash(l).trim())).filter(Boolean).join("\n");
      add("para", tag === "BLOCKQUOTE" ? text.split("\n").map((l) => `> ${l}`).join("\n") : text);
      return;
    }
    if (INLINE.has(tag)) {
      loose += inline(node, image);
      return;
    }
    // Containers (div, section, article, li outside a list…): their children are blocks of their own.
    flush();
    for (const c of kids(node)) walk(c);
    flush();
  };
  for (const c of kids(doc.body as unknown as DomNode)) walk(c);
  flush();
  return withEstimatedPages(out);
}

/**
 * A fetched page: `@mozilla/readability` keeps the main content (§3 Web), then the walker reads it. A page it can't
 * read (too little content) is read whole.
 */
export function readablePage(html: string): { title: string; blocks: MdBlock[] } {
  const { document } = parseHTML(html);
  const title = squash(document.querySelector("title")?.textContent ?? "").trim();
  let content: string | null = null;
  try {
    content = new Readability(document as unknown as Document).parse()?.content ?? null;
  } catch {
    content = null;
  }
  const blocks = htmlBlocks(content && content.length > 200 ? content : html);
  // The title as the first heading when the content has none.
  if (title && !blocks.some((b) => b.kind === "heading")) blocks.unshift({ kind: "heading", level: 1, md: `# ${title}`, loc: "start", page: 1 });
  return { title, blocks };
}
