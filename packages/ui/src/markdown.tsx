import { Fragment, type ReactNode, createElement, useContext, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Code, Definition, FootnoteDefinition, Heading, List, Nodes, Parents, PhrasingContent, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { CALLOUTS, type Callout, createSlugger, splitFrontMatter } from "@humanharness/harness-sdk/documents";
import { CitationContext, splitCitations } from "./citations";

export { markdownToPlain } from "./markdown-plain";

/**
 * The rich renderer for the chat and the document reader (document-reader spec §3): `remark-parse` + `remark-gfm`
 * into mdast, then straight to React elements. There is no raw-HTML path: HTML in the source is shown as text.
 */
const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(text: string): Root {
  return processor.parse(text) as Root;
}

/** Everything a node needs to draw itself. */
interface Ctx {
  fade: boolean;
  /** A single newline is a line break (the chat); off in documents. */
  breaks: boolean;
  /** Put before every id this text makes (headings, footnotes). */
  prefix: string;
  slug: (text: string) => string;
  /** The parsed text, for the source of a node (an unclosed fence). */
  source: string;
  /** The document's own path (relative to the folder); "" in the chat. */
  base: string;
  definitions: Map<string, Definition>;
  /** Footnote ids in the order they are first referenced, and their definitions. */
  footnotes: { order: string[]; defs: Map<string, FootnoteDefinition> };
  t: TFunction;
}

/** A node's plain text (headings' ids, captions, link labels). */
export function textOf(node: Nodes): string {
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(textOf).join("");
  return "";
}

/**
 * Text that fades in word by word as it arrives: each word is its own span, and a span already on screen keeps
 * its place (and so doesn't fade again) when more words come after it.
 */
function fadingWords(text: string): ReactNode[] {
  return text.split(/(\s+)/).map((w, i) => (!w || /^\s+$/.test(w) ? w : <span key={i} className="hh-word">{w}</span>));
}

/** `[[frag:<id>]]` (material spec §9): "<source>, <location>", which opens the original; text when there is no such fragment. */
function Citation({ id }: { id: string }) {
  const cite = useContext(CitationContext);
  const { t } = useTranslation();
  const [label, setLabel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    cite?.label(id).then(
      (l) => live && setLabel(l),
      () => live && setLabel(null),
    );
    return () => {
      live = false;
    };
  }, [cite, id]);
  // Until the label arrives, or when there is none, the marker stays plain text: no empty button to land on.
  if (!cite || !label) return <>{`[[frag:${id}]]`}</>;
  const opens = t("material.openOriginal");
  return (
    <button type="button" className="hh-citation" title={opens} aria-description={opens} onClick={() => cite.open(id)}>
      {label}
    </button>
  );
}

/** A text run with its citations drawn, only inside a `CitationContext`; otherwise exactly the text (D0). */
function CitedText({ text, fade }: { text: string; fade: boolean }) {
  const cite = useContext(CitationContext);
  if (!cite || !text.includes("[[frag:")) return <>{fade ? fadingWords(text) : text}</>;
  return (
    <>
      {splitCitations(text).map((part, i) =>
        typeof part === "string" ? <Fragment key={i}>{fade ? fadingWords(part) : part}</Fragment> : <Citation key={i} id={part.id} />,
      )}
    </>
  );
}

/** A text node: in the chat a single newline is a line break. */
function renderText(value: string, ctx: Ctx, key: number): ReactNode {
  if (!ctx.breaks || !value.includes("\n")) return <CitedText key={key} text={value} fade={ctx.fade} />;
  return (
    <Fragment key={key}>
      {value.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <CitedText text={line} fade={ctx.fade} />
        </Fragment>
      ))}
    </Fragment>
  );
}

function renderInline(nodes: PhrasingContent[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => renderPhrasing(n, ctx, i));
}

function renderPhrasing(n: PhrasingContent, ctx: Ctx, i: number): ReactNode {
  switch (n.type) {
    case "text":
      return renderText(n.value, ctx, i);
    case "html":
      // Raw HTML stays text, always.
      return <Fragment key={i}>{n.value}</Fragment>;
    case "inlineCode":
      return (
        <code key={i} className={ctx.fade ? "hh-word" : undefined}>
          {n.value}
        </code>
      );
    case "strong":
      return <strong key={i}>{renderInline(n.children, ctx)}</strong>;
    case "emphasis":
      return <em key={i}>{renderInline(n.children, ctx)}</em>;
    case "delete":
      return <del key={i}>{renderInline(n.children, ctx)}</del>;
    case "break":
      return <br key={i} />;
    case "link":
      return renderLink(n.url, n.children, ctx, i);
    case "linkReference": {
      const def = ctx.definitions.get(n.identifier);
      return def ? renderLink(def.url, n.children, ctx, i) : <Fragment key={i}>{renderInline(n.children, ctx)}</Fragment>;
    }
    case "image":
      return renderImage(n.url, n.alt ?? "", ctx, i);
    case "imageReference": {
      const def = ctx.definitions.get(n.identifier);
      return def ? renderImage(def.url, n.alt ?? "", ctx, i) : <Fragment key={i}>{n.alt ?? ""}</Fragment>;
    }
    case "footnoteReference":
      return renderFootnoteReference(n.identifier, ctx, i);
    default:
      return null;
  }
}

/** A link (§3.4). Task 7 gives it its rules; until then it is today's: the text, then its URL. */
function renderLink(url: string, children: PhrasingContent[], ctx: Ctx, key: number): ReactNode {
  const label = children.map(textOf).join("");
  return (
    <Fragment key={key}>
      {renderInline(children, ctx)}
      {label !== url && <span className="hh-md-url">{` (${url})`}</span>}
    </Fragment>
  );
}

/** An image (§3.2). Task 7 reads local files; until then its alt text. */
function renderImage(_url: string, alt: string, _ctx: Ctx, key: number): ReactNode {
  return (
    <span key={key} className="hh-md-alt">
      {alt}
    </span>
  );
}

/** A footnote reference: its number by first use, linked to its note and back (only the first use is the back target). */
function renderFootnoteReference(id: string, ctx: Ctx, key: number): ReactNode {
  if (!ctx.footnotes.defs.has(id)) return <Fragment key={key}>{`[^${id}]`}</Fragment>;
  let n = ctx.footnotes.order.indexOf(id);
  const first = n < 0;
  if (first) n = ctx.footnotes.order.push(id) - 1;
  return (
    <sup key={key}>
      <a
        href={`#${ctx.prefix}fn-${id}`}
        id={first ? `${ctx.prefix}fnref-${id}` : undefined}
        className="hh-md-fnref"
        onClick={(e) => jump(e, `${ctx.prefix}fn-${id}`)}
      >
        {n + 1}
      </a>
    </sup>
  );
}

/** Scrolls to an id inside the app (never a navigation). */
function jump(e: { preventDefault(): void }, id: string): void {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView?.({ block: "start" });
}

/** The notes at the end, in the order they were referenced. */
function renderFootnotes(ctx: Ctx): ReactNode {
  if (ctx.footnotes.order.length === 0) return null;
  // Headings inside a note get no id: the outline never lists them.
  const inner: Ctx = { ...ctx, slug: () => "" };
  const items: ReactNode[] = [];
  // A note may reference a later one: `order` grows while the notes are drawn.
  for (let i = 0; i < ctx.footnotes.order.length; i++) {
    const id = ctx.footnotes.order[i];
    const def = ctx.footnotes.defs.get(id)!;
    items.push(
      <li key={id} id={`${ctx.prefix}fn-${id}`}>
        {renderBlocks(def.children, inner, true)}{" "}
        <a href={`#${ctx.prefix}fnref-${id}`} className="hh-md-back" aria-label={ctx.t("reader.backToText")} onClick={(e) => jump(e, `${ctx.prefix}fnref-${id}`)}>
          ↩
        </a>
      </li>,
    );
  }
  return (
    <section className="hh-md-footnotes" aria-label={ctx.t("reader.footnotes")}>
      <ol>{items}</ol>
    </section>
  );
}

function renderHeading(n: Heading, ctx: Ctx, key: number): ReactNode {
  if (n.depth > 4) {
    return (
      <p key={key} className="hh-md-heading">
        <strong>{renderInline(n.children, ctx)}</strong>
      </p>
    );
  }
  // An empty slug (a heading inside a footnote) means no id.
  const slug = ctx.slug(textOf(n));
  return createElement(`h${n.depth}`, { key, id: slug ? `${ctx.prefix}${slug}` : undefined, className: "hh-md-h", "data-heading": "" }, renderInline(n.children, ctx));
}

function renderList(n: List, ctx: Ctx, key: number): ReactNode {
  const items = n.children.map((item, j) => (
    <li key={j} className={item.checked === null || item.checked === undefined ? undefined : "hh-md-task"}>
      {typeof item.checked === "boolean" && <input type="checkbox" checked={item.checked} disabled readOnly />}
      {renderBlocks(item.children, ctx, !n.spread && !item.spread)}
    </li>
  ));
  if (n.ordered) {
    return (
      <ol key={key} className="hh-md-list" start={n.start === 1 || n.start === null || n.start === undefined ? undefined : n.start}>
        {items}
      </ol>
    );
  }
  return (
    <ul key={key} className="hh-md-list">
      {items}
    </ul>
  );
}

const alignClass = (a: NonNullable<Table["align"]>[number] | undefined): string | undefined =>
  a === "right" ? "hh-num" : a === "center" ? "hh-align-center" : undefined;

function renderTable(n: Table, ctx: Ctx, key: number): ReactNode {
  const [head, ...rows] = n.children;
  const align = n.align ?? [];
  return (
    <div key={key} className="hh-md-table" role="region" tabIndex={0} aria-label={ctx.t("reader.table")}>
      <table>
        {head && (
          <thead>
            <tr>
              {head.children.map((c, i) => (
                <th key={i} className={alignClass(align[i])}>
                  {renderInline(c.children, ctx)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, j) => (
            <tr key={j}>
              {r.children.map((c, i) => (
                <td key={i} className={alignClass(align[i])}>
                  {renderInline(c.children, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A fenced or indented code block. Task 8 highlights it and Task 9 draws Mermaid. */
function renderCode(n: Code, _ctx: Ctx, key: number, _caption?: string): ReactNode {
  return (
    <pre key={key} className="hh-md-code">
      <code>{n.value}</code>
    </pre>
  );
}

// Linear: one bracketed word, then optional blanks and one newline.
const CALLOUT_MARK = /^\[!([A-Za-z]+)\][ \t]*\n?/;

/** A blockquote, or a callout (§3.2) when its first paragraph starts with one of the six markers. */
function renderBlockquote(children: RootContent[], ctx: Ctx, key: number): ReactNode {
  const first = children[0];
  const lead = first?.type === "paragraph" ? first.children[0] : undefined;
  const mark = lead?.type === "text" ? CALLOUT_MARK.exec(lead.value) : null;
  const kind = mark?.[1].toLowerCase();
  if (!mark || !kind || !(CALLOUTS as readonly string[]).includes(kind) || first?.type !== "paragraph" || lead?.type !== "text") {
    return (
      <blockquote key={key} className="hh-md-quote">
        {renderBlocks(children, ctx)}
      </blockquote>
    );
  }
  // The marker goes; the rest of the first paragraph stays (a callout may put text right after the marker).
  const rest = lead.value.slice(mark[0].length);
  const inline: PhrasingContent[] = [...(rest ? [{ ...lead, value: rest }] : []), ...first.children.slice(1)];
  const body: RootContent[] = inline.length > 0 ? [{ ...first, children: inline }, ...children.slice(1)] : children.slice(1);
  return (
    <div key={key} className={`hh-callout hh-callout-${kind}`} role="note">
      <p className="hh-callout-label">
        <CalloutIcon kind={kind as Callout} />
        {ctx.t(`reader.callout.${kind}`)}
      </p>
      {renderBlocks(body, ctx)}
    </div>
  );
}

const CALLOUT_ICONS: Record<Callout, string> = {
  note: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  tip: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z",
  warning: "M12 9v4M12 17h.01M10.3 4l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z",
  summary: "M5 6h14M5 12h14M5 18h9",
  decision: "M5 12l4 4 10-10",
  question: "M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2v.3M12 17h.01",
};

/** A small line icon per callout, in the text colour (no colour of its own). */
function CalloutIcon({ kind }: { kind: Callout }) {
  return (
    <svg className="hh-callout-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CALLOUT_ICONS[kind]} />
    </svg>
  );
}

function renderBlock(n: RootContent, ctx: Ctx, key: number, tight: boolean, caption?: string): ReactNode {
  switch (n.type) {
    case "paragraph":
      return tight ? <Fragment key={key}>{renderInline(n.children, ctx)}</Fragment> : <p key={key}>{renderInline(n.children, ctx)}</p>;
    case "heading":
      return renderHeading(n, ctx, key);
    case "list":
      return renderList(n, ctx, key);
    case "table":
      return renderTable(n, ctx, key);
    case "code":
      return renderCode(n, ctx, key, caption);
    case "blockquote":
      return renderBlockquote(n.children, ctx, key);
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return (
        <p key={key} className="hh-md-raw">
          {n.value}
        </p>
      );
    // Definitions are drawn where they are used; footnote definitions at the end.
    default:
      return null;
  }
}

/** An italic paragraph (one `emphasis` and nothing else), a caption when it follows a table or a Mermaid diagram (§3.2). */
function captionOf(n: RootContent | undefined): PhrasingContent[] | undefined {
  if (n?.type !== "paragraph" || n.children.length !== 1) return undefined;
  const only = n.children[0];
  return only.type === "emphasis" ? only.children : undefined;
}
const captioned = (n: RootContent | undefined) => n?.type === "table" || (n?.type === "code" && n.lang?.toLowerCase() === "mermaid");

/** Children of a block, in order. `tight`: a tight list item's paragraphs are drawn without `<p>`. */
function renderBlocks(nodes: RootContent[], ctx: Ctx, tight = false): ReactNode[] {
  return nodes.map((n, i) => {
    const caption = captionOf(n);
    if (caption && captioned(nodes[i - 1])) {
      return (
        <p key={i} className="hh-md-caption">
          {renderInline(caption, ctx)}
        </p>
      );
    }
    const next = nodes[i + 1];
    return renderBlock(n, ctx, i, tight, captioned(n) && captionOf(next) ? textOf(next!) : undefined);
  });
}

function collectDefinitions(tree: Root): Map<string, Definition> {
  const out = new Map<string, Definition>();
  const walk = (node: Nodes) => {
    if (node.type === "definition" && !out.has(node.identifier)) out.set(node.identifier, node);
    if ("children" in node) for (const c of node.children as Nodes[]) walk(c);
  };
  walk(tree);
  return out;
}

function collectFootnotes(tree: Root): Map<string, FootnoteDefinition> {
  const out = new Map<string, FootnoteDefinition>();
  for (const n of tree.children) if (n.type === "footnoteDefinition" && !out.has(n.identifier)) out.set(n.identifier, n);
  return out;
}

export interface MarkdownProps {
  /** The Markdown text. */
  source: string;
  /** Each new word fades in (an answer arriving). */
  fade?: boolean;
  /** A document (the reader, or a harness view of a file): its front-matter is hidden and soft breaks are spaces. */
  document?: boolean;
  /** The document's path inside the folder: relative links and images resolve from its folder. */
  path?: string;
  /** Put before every id; default: one of this component's own (the reader passes ""). */
  idPrefix?: string;
}

/** Markdown as React elements (document-reader spec §3). */
export function Markdown({ source, fade = false, document = false, path = "", idPrefix }: MarkdownProps) {
  const { t } = useTranslation();
  const auto = useId();
  const prefix = idPrefix ?? `m${auto.replace(/[^A-Za-z0-9]/g, "")}-`;
  const text = document ? splitFrontMatter(source).body : source;
  const tree = useMemo(() => parseMarkdown(text), [text]);
  const definitions = useMemo(() => collectDefinitions(tree), [tree]);
  const defs = useMemo(() => collectFootnotes(tree), [tree]);
  // A fresh slugger and footnote order per draw: ids and numbers come out in document order every time.
  const ctx: Ctx = { fade, breaks: !document, prefix, slug: createSlugger(), source: text, base: path, definitions, footnotes: { order: [], defs }, t };
  // The body first, so the notes' order is known when they are drawn.
  const body = renderBlocks(tree.children, ctx);
  return (
    <>
      {body}
      {renderFootnotes(ctx)}
    </>
  );
}

/** A heading the reader's table of contents lists. */
export interface OutlineItem {
  depth: 2 | 3;
  text: string;
  id: string;
}

/**
 * The document's `##` and `###` headings with the ids `Markdown` gives them (empty prefix), its `##` texts for the
 * template check, and its front-matter. Ids are made in the same order as the renderer makes them.
 */
export function documentOutline(source: string): { front: Record<string, string>; outline: OutlineItem[]; sections: string[] } {
  const fm = splitFrontMatter(source);
  const slug = createSlugger();
  const outline: OutlineItem[] = [];
  const sections: string[] = [];
  const walk = (node: Nodes) => {
    if (node.type === "footnoteDefinition") return;
    if (node.type === "heading" && node.depth <= 4) {
      const text = textOf(node);
      const id = slug(text);
      if (node.depth === 2) sections.push(text);
      if (node.depth === 2 || node.depth === 3) outline.push({ depth: node.depth, text, id });
    }
    if ("children" in node) for (const c of (node as Parents).children as Nodes[]) walk(c);
  };
  walk(parseMarkdown(fm.body));
  return { front: fm.data, outline, sections };
}
