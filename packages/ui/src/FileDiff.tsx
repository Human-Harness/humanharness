import { type ReactNode, type RefObject, createElement, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffPart, FileDiffResult, HarnessClient, LineChange, MdDiffBlock } from "./client";
import { highlightCode } from "./highlight";
import { Markdown } from "./markdown";
import { formatSize } from "./sizes";

/** Unchanged lines kept on each side of a change. */
const CONTEXT = 3;
/** Under this width the side-by-side layout falls back to inline (§4.3). */
const SIDE_MIN_PX = 900;

export type DiffLayout = "inline" | "side";
type Side = "both" | "before" | "after";

export interface FileDiffProps {
  client: HarnessClient;
  path: string;
  /** null: nothing before (the file was new). */
  from: string | null;
  /** A commit, or the file now. */
  to: string | "current";
  /** The layout to start with; the person can switch. */
  layout?: DiffLayout;
}

/** The changed items and up to CONTEXT unchanged ones around each; null marks a gap ("…") between kept runs. */
export function aroundChanges<T extends { kind: string }>(lines: T[]): (T | null)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === "same") continue;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true;
  }
  const out: (T | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) out.push(lines[i]);
    else if (out.at(-1) !== null) out.push(null);
  }
  if (out.at(-1) === null) out.pop();
  return out;
}

/** Lines as rows of two columns: a run of deleted lines beside the run of added lines that follows it. */
export function sideRows(lines: LineChange[]): { left?: LineChange; right?: LineChange }[] {
  const rows: { left?: LineChange; right?: LineChange }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "same") {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels: LineChange[] = [];
    const inss: LineChange[] = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === "ins") inss.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, inss.length); k++) rows.push({ ...(dels[k] ? { left: dels[k] } : {}), ...(inss[k] ? { right: inss[k] } : {}) });
  }
  return rows;
}

/** Word parts as text: `ins`/`del` marks, or one side only. Never HTML. */
function Parts({ parts, side }: { parts: DiffPart[]; side: Side }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "ins" ? (
          side === "before" ? null : <ins key={i}>{p.text}</ins>
        ) : side === "after" ? null : (
          <del key={i}>{p.text}</del>
        ),
      )}
    </>
  );
}

/** One line's text, highlighted when its language is known; always React text, never HTML. */
const lineText = (lang: string | null, text: string) => <code>{highlightCode(lang, text) ?? text}</code>;

function Lines({ lines, lang }: { lines: LineChange[]; lang: string | null }) {
  const { t } = useTranslation();
  return (
    <table className="hh-filediff-lines">
      <tbody>
        {aroundChanges(lines).map((l, i) =>
          l === null ? (
            <tr key={i} className="hh-filediff-gap" aria-hidden="true">
              <td colSpan={4}>…</td>
            </tr>
          ) : (
            <tr key={i} className={`hh-filediff-${l.kind}`}>
              <td className="hh-filediff-no">{l.old ?? ""}</td>
              <td className="hh-filediff-no">{l.new ?? ""}</td>
              <td className="hh-filediff-sign">
                {l.kind === "ins" ? "+" : l.kind === "del" ? "−" : ""}
                {l.kind !== "same" && <span className="hh-sr-only">{l.kind === "ins" ? t("timeline.added") : t("timeline.removed")}</span>}
              </td>
              <td>{lineText(lang, l.text)}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function SideLines({ lines, lang }: { lines: LineChange[]; lang: string | null }) {
  return (
    <div className="hh-filediff-grid hh-filediff-mono">
      {aroundChanges(sideRows(lines).map((r) => ({ ...r, kind: r.left?.kind === "same" ? "same" : "changed" }))).map((r, i) =>
        r === null ? (
          <div key={i} className="hh-filediff-gaprow" aria-hidden="true">
            …
          </div>
        ) : (
          <div key={i} className="hh-filediff-row">
            <div className={`hh-filediff-before${r.left ? ` hh-filediff-${r.left.kind}` : ""}`}>{r.left && lineText(lang, r.left.text)}</div>
            <div className={`hh-filediff-after${r.right ? ` hh-filediff-${r.right.kind}` : ""}`}>{r.right && lineText(lang, r.right.text)}</div>
          </div>
        ),
      )}
    </div>
  );
}

/** A block's source on one side; an unchanged block carries `after` only (it is the same on both). */
function sourceOn(b: MdDiffBlock, side: Side): string | undefined {
  if (b.status === "same") return b.after ?? b.before;
  if (side === "before") return b.status === "added" ? undefined : b.before;
  if (side === "after") return b.status === "removed" ? undefined : b.after;
  return b.after ?? b.before;
}

/** One block's look on one side: whole with the reader's renderer, or its plain text with word marks when it changed. */
function BlockView({ b, side, path, n }: { b: MdDiffBlock; side: Side; path: string; n: number }) {
  const { t } = useTranslation();
  const [source, setSource] = useState(false);
  const whole = (text: string | undefined) => (text === undefined ? null : <Markdown source={text} document path={path} idPrefix={`hh-d${n}-${side}-`} />);
  if (b.status !== "changed") return whole(sourceOn(b, side));
  if (b.type === "mermaid") {
    return (
      <div className="hh-filediff-diagrams">
        {side !== "after" && (
          <figure>
            <figcaption>{t("timeline.before")}</figcaption>
            {whole(b.before)}
          </figure>
        )}
        {side !== "before" && (
          <figure>
            <figcaption>{t("timeline.after")}</figcaption>
            {whole(b.after)}
          </figure>
        )}
        <button type="button" aria-pressed={source} onClick={() => setSource((s) => !s)}>
          {t("timeline.source")}
        </button>
        {source && b.lines && <Lines lines={b.lines} lang={null} />}
      </div>
    );
  }
  if (b.lines) return <Lines lines={b.lines} lang={null} />;
  const parts = <Parts parts={b.parts ?? []} side={side} />;
  if (b.type === "heading") return createElement(`h${Math.min(Math.max(b.depth ?? 2, 1), 6)}`, null, parts);
  if (b.type === "listItem")
    return (
      <ul>
        <li>{parts}</li>
      </ul>
    );
  return <p>{parts}</p>;
}

function rowCells(b: MdDiffBlock, side: Side): ReactNode[] {
  const c = b.cells ?? {};
  if (b.status === "changed" && c.parts) return c.parts.map((p, i) => <td key={i}>{<Parts parts={p} side={side} />}</td>);
  const cells = (b.status === "same" ? (c.after ?? c.before) : side === "before" ? c.before : side === "after" ? c.after : (c.after ?? c.before)) ?? [];
  return cells.map((text, i) => <td key={i}>{text}</td>);
}

const statusClass = (b: MdDiffBlock) => (b.status === "same" ? "" : ` hh-filediff-${b.status}`);

/** Consecutive table rows drawn as one table; every other block on its own. */
function groups(blocks: MdDiffBlock[]): (MdDiffBlock | MdDiffBlock[])[] {
  const out: (MdDiffBlock | MdDiffBlock[])[] = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (b.type === "tableRow" && Array.isArray(last)) last.push(b);
    else out.push(b.type === "tableRow" ? [b] : b);
  }
  return out;
}

/** One side of one block in the side-by-side grid; the bar shows on the side that has it (removed left, added right). */
function SideCell({ b, side, path, n }: { b: MdDiffBlock; side: "before" | "after"; path: string; n: number }) {
  const bar = (b.status === "removed" && side === "before") || (b.status === "added" && side === "after") ? statusClass(b) : "";
  return (
    <div className={`hh-filediff-${side}${bar}`}>
      {b.type === "tableRow" ? (
        <table className="hh-filediff-table">
          <tbody>
            <tr>{rowCells(b, side)}</tr>
          </tbody>
        </table>
      ) : (
        <BlockView b={b} side={side} path={path} n={n} />
      )}
    </div>
  );
}

function MarkdownDiff({ blocks, path, layout }: { blocks: MdDiffBlock[]; path: string; layout: DiffLayout }) {
  const { t } = useTranslation();
  const label = (b: MdDiffBlock) => (b.status === "added" ? t("timeline.added") : b.status === "removed" ? t("timeline.removed") : "");
  if (layout === "side") {
    return (
      <div className="hh-filediff-grid">
        {blocks.map((b, i) => (
          <div key={i} className="hh-filediff-row">
            <SideCell b={b} side="before" path={path} n={i} />
            <SideCell b={b} side="after" path={path} n={i} />
          </div>
        ))}
      </div>
    );
  }
  let n = 0;
  return (
    <>
      {groups(blocks).map((g, i) =>
        Array.isArray(g) ? (
          <table key={i} className="hh-filediff-table">
            <tbody>
              {g.map((b, k) => (
                <tr key={k} className={statusClass(b).trim() || undefined}>
                  {rowCells(b, "both")}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div key={i} className={`hh-filediff-block${statusClass(g)}`}>
            {label(g) && <span className="hh-sr-only">{label(g)}</span>}
            <BlockView b={g} side="both" path={path} n={n++} />
          </div>
        ),
      )}
    </>
  );
}

/** The width of `ref`'s box, followed while it changes (null before the first measure or without ResizeObserver). */
function useWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** What changed in a file between two versions (file-timeline spec §4), inline or side by side. Text only, never HTML. */
export function FileDiff({ client, path, from, to, layout: initial = "inline" }: FileDiffProps) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<FileDiffResult | null>(null);
  const [layout, setLayout] = useState<DiffLayout>(initial);
  const [source, setSource] = useState(false);
  const box = useRef<HTMLElement>(null);
  const width = useWidth(box);
  useEffect(() => {
    let live = true;
    setDiff(null);
    client.files.diff(path, from, to).then(
      (d) => live && setDiff(d),
      () => live && setDiff({ ok: false, reason: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [client, path, from, to]);
  // Narrow: inline whatever was picked; the choice stays for when the box widens (§4.3, Q12).
  const shown: DiffLayout = layout === "side" && width !== null && width < SIDE_MIN_PX ? "inline" : layout;
  let body: ReactNode;
  if (diff === null) body = <p className="hh-caption" role="status">{t("timeline.loading")}</p>;
  else if (!diff.ok) body = <p className="hh-warn" role="alert">{t("timeline.diffFailed")}</p>;
  else if (diff.same) body = <p className="hh-caption">{t("timeline.noChanges")}</p>;
  else if (diff.kind === "binary")
    body = (
      <p className="hh-caption">
        {t("timeline.binary", {
          before: diff.sizes.before === null ? t("timeline.noFile") : formatSize(diff.sizes.before),
          after: diff.sizes.after === null ? t("timeline.noFile") : formatSize(diff.sizes.after),
        })}
      </p>
    );
  // A `.md` main could not take as blocks also arrives here (`lang: "md"`): its plain lines.
  else if (diff.kind === "text") body = shown === "side" ? <SideLines lines={diff.lines} lang={diff.lang} /> : <Lines lines={diff.lines} lang={diff.lang} />;
  // The raw text, unhighlighted: it is what the person reads to check the marks.
  else if (source) body = shown === "side" ? <SideLines lines={diff.source} lang={null} /> : <Lines lines={diff.source} lang={null} />;
  else body = <MarkdownDiff blocks={diff.blocks} path={path} layout={shown} />;
  const canLayout = diff?.ok === true && !diff.same && diff.kind !== "binary";
  return (
    <section ref={box} className={`hh-filediff hh-filediff-${shown}`} aria-label={t("timeline.diff")}>
      {canLayout && (
        <div className="hh-filediff-tools">
          <div className="hh-segmented" role="group" aria-label={t("timeline.layout")}>
            <button type="button" aria-pressed={layout === "inline"} onClick={() => setLayout("inline")}>
              {t("timeline.inline")}
            </button>
            <button type="button" aria-pressed={layout === "side"} onClick={() => setLayout("side")}>
              {t("timeline.sideBySide")}
            </button>
          </div>
          {diff?.ok && diff.kind === "markdown" && (
            <button type="button" aria-pressed={source} onClick={() => setSource((s) => !s)}>
              {t("timeline.source")}
            </button>
          )}
        </div>
      )}
      {diff?.ok && diff.kind !== "binary" && diff.truncated && (
        <p className="hh-caption" role="note">
          {t("timeline.truncated")}
        </p>
      )}
      {body}
    </section>
  );
}
