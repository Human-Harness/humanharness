import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DocumentKind, checkTemplate, readingMinutes, refusedShape, wordCount } from "@humanharness/harness-sdk/documents";
import type { DocumentRead, HarnessClient, ReaderPrefs } from "./client";
import { DocumentContext, type DocumentHost } from "./documents-context";
import { Markdown, documentOutline } from "./markdown";

/** What the reader shows: a document, the place to open at, and the agent of the turn that wrote it. */
export interface ReaderTarget {
  path: string;
  anchor?: string;
  agent?: string;
}

/** Over this the reader draws only the first `SHOWN_BYTES` (§6). */
const BIG_BYTES = 1024 * 1024;
const SHOWN_BYTES = 200 * 1024;

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The id of the last heading at or above the top of `box` (the place to keep across a reload). */
function headingAtTop(box: HTMLElement | null): string | null {
  if (!box) return null;
  const top = box.getBoundingClientRect().top;
  let last: string | null = null;
  for (const h of box.querySelectorAll<HTMLElement>("[data-heading]")) {
    if (h.getBoundingClientRect().top <= top + 8) last = h.id || last;
    else break;
  }
  return last;
}

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: "start" });

/** The reader panel (document-reader spec §5.2): a document beside the chat, or full screen. Never writes. */
export function DocumentReader({
  client,
  target,
  kinds,
  prefs,
  onPrefs,
  full,
  onFull,
  onClose,
  onOpen,
}: {
  client: HarnessClient;
  target: ReaderTarget;
  kinds?: Record<string, DocumentKind>;
  prefs: ReaderPrefs;
  /** Both fields, always: the caller saves the whole object. */
  onPrefs: (p: Required<ReaderPrefs>) => void;
  full: boolean;
  onFull: (full: boolean) => void;
  onClose: () => void;
  /** A `.md` link inside the document. */
  onOpen: (path: string, anchor?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [doc, setDoc] = useState<DocumentRead | null>(null);
  const [source, setSource] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  // The look applies at once; the caller saves it and passes it back.
  const [look, setLook] = useState<Required<ReaderPrefs>>({ font: prefs.font ?? "sans", size: prefs.size ?? "normal" });
  useEffect(() => setLook({ font: prefs.font ?? "sans", size: prefs.size ?? "normal" }), [prefs.font, prefs.size]);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Where to scroll once the next text is drawn: the anchor asked for, or the heading kept across a reload. */
  const restore = useRef<string | null>(target.anchor ?? null);
  // The target may come from a harness's own UI (`client.openDocument`): never trust its shape.
  const path = typeof target.path === "string" ? target.path : "";
  const refused = refusedShape(target.path);

  useEffect(() => {
    setDoc(null);
    setSource(false);
    if (refused) {
      setDoc({ ok: false, reason: "outside" });
      return;
    }
    let live = true;
    const read = () =>
      client.readDocument(path).then(
        (d) => live && setDoc(d),
        () => live && setDoc({ ok: false, reason: "missing" }),
      );
    void read();
    const off = client.watchDocument(path, () => {
      restore.current = headingAtTop(scrollRef.current);
      void read();
    });
    return () => {
      live = false;
      off();
    };
  }, [client, path, refused]);

  // A new anchor in the same document: go there now, or once the text is drawn.
  const docRef = useRef(doc);
  docRef.current = doc;
  useEffect(() => {
    if (!target.anchor) return;
    if (docRef.current?.ok) scrollToId(target.anchor);
    else restore.current = target.anchor;
  }, [target]);

  useLayoutEffect(() => {
    const id = restore.current;
    if (!doc?.ok || !id) return;
    restore.current = null;
    scrollToId(id);
  }, [doc]);

  const text = doc?.ok ? doc.text : "";
  const big = doc?.ok === true && doc.size > BIG_BYTES;
  const shown = big ? text.slice(0, SHOWN_BYTES) : text;
  const { front, outline, sections } = useMemo(() => documentOutline(shown), [shown]);
  // The whole text, not only the part drawn: the reading time is the document's.
  const minutes = useMemo(() => readingMinutes(wordCount(text)), [text]);
  const check = checkTemplate(kinds, front, sections);
  const host = useMemo<DocumentHost>(
    () => ({ open: onOpen, image: (p) => client.readImage(p).catch(() => null), ...(kinds ? { kinds } : {}) }),
    [client, kinds, onOpen],
  );
  const setPref = (change: ReaderPrefs) => {
    const next = { ...look, ...change };
    setLook(next);
    onPrefs(next);
  };
  const crumbs = path.split("/").filter(Boolean);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (prefsOpen) setPrefsOpen(false);
    else onClose();
  };

  let body: ReactNode;
  if (!doc) body = <p className="hh-caption" role="status">{t("reader.loading")}</p>;
  else if (!doc.ok) {
    body = (
      <p className="hh-reader-problem" role="alert">
        {doc.reason === "too-large" ? t("reader.tooLarge", { size: formatSize(doc.size ?? 0) }) : t(`reader.problem.${doc.reason}`)}
      </p>
    );
  } else if (source) {
    body = <pre className="hh-reader-source">{doc.text}</pre>;
  } else {
    const allowed = check?.badStatus ? kinds?.[check.kind]?.status : undefined;
    body = (
      <>
        <div className="hh-reader-meta">
          {check?.unknownKind ? <span className="hh-reader-chip hh-reader-chip-muted">{t("reader.unknownKind")}</span> : front.kind && <span className="hh-reader-chip">{front.kind}</span>}
          {front.status && <span className="hh-reader-chip">{front.status}</span>}
          {allowed && (
            <span className="hh-warn" role="note">
              {t("reader.badStatus", { allowed: allowed.join(", ") })}
            </span>
          )}
          <span>{t("reader.changed", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(doc.mtime)) })}</span>
          <span>{t("reader.minutes", { count: minutes })}</span>
          {target.agent && <span>{t("reader.writtenBy", { agent: target.agent })}</span>}
        </div>
        {front.title && (
          <h1 className="hh-reader-title" tabIndex={-1}>
            {front.title}
          </h1>
        )}
        <DocumentContext.Provider value={host}>
          <Markdown source={shown} document path={path} idPrefix="" />
        </DocumentContext.Provider>
        {big && (
          <p className="hh-reader-truncated" role="note">
            {t("reader.truncated", { shown: formatSize(SHOWN_BYTES), size: formatSize(doc.size) })}
          </p>
        )}
      </>
    );
  }

  return (
    <aside className={`hh-reader${full ? " hh-reader-is-full" : ""}`} aria-label={t("reader.title")} onKeyDown={onKeyDown}>
      <header className="hh-reader-bar">
        <nav aria-label={t("reader.path")}>
          <ol className="hh-reader-crumbs">
            {crumbs.map((c, i) => (
              <li key={i} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c}
              </li>
            ))}
          </ol>
        </nav>
        <div className="hh-reader-actions">
          <button type="button" aria-pressed={source} disabled={!doc?.ok} onClick={() => setSource((s) => !s)}>
            {t("reader.source")}
          </button>
          <button type="button" aria-expanded={prefsOpen} onClick={() => setPrefsOpen((o) => !o)} aria-label={t("reader.prefs")}>
            Aa
          </button>
          <button type="button" onClick={() => onFull(!full)}>
            {full ? t("reader.showChat") : t("reader.fullScreen")}
          </button>
          <button type="button" onClick={onClose}>
            {t("reader.close")}
          </button>
        </div>
        {prefsOpen && (
          <div className="hh-reader-prefs" role="group" aria-label={t("reader.prefs")}>
            <div className="hh-segmented">
              <button type="button" aria-pressed={look.font === "sans"} onClick={() => setPref({ font: "sans" })}>
                {t("reader.sans")}
              </button>
              <button type="button" aria-pressed={look.font === "serif"} onClick={() => setPref({ font: "serif" })}>
                {t("reader.serif")}
              </button>
            </div>
            <div className="hh-segmented">
              <button type="button" aria-pressed={look.size === "normal"} onClick={() => setPref({ size: "normal" })}>
                {t("reader.normal")}
              </button>
              <button type="button" aria-pressed={look.size === "large"} onClick={() => setPref({ size: "large" })}>
                {t("reader.large")}
              </button>
            </div>
          </div>
        )}
      </header>
      <div className="hh-reader-columns">
        {doc?.ok && !source && (outline.length > 0 || (check && check.missing.length > 0)) && (
          <nav className="hh-reader-toc" aria-label={t("reader.contents")}>
            <ol>
              {outline.map((h) => (
                <li key={h.id} className={`hh-toc-${h.depth}`}>
                  <a
                    href={`#${h.id}`}
                    aria-current={current === h.id ? "location" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToId(h.id);
                    }}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ol>
            {check && check.missing.length > 0 && (
              <p className="hh-reader-template" role="note">
                {`${t("reader.templateLabel")} ${check.kind}: ${t("reader.missing", { count: check.missing.length })} `}
                <strong>{check.missing.join(", ")}</strong>.
              </p>
            )}
          </nav>
        )}
        <div className="hh-reader-scroll" ref={scrollRef} onScroll={() => setCurrent(headingAtTop(scrollRef.current))}>
          <article className={`hh-reader-doc hh-reader-${look.font}${look.size === "large" ? " hh-reader-large" : ""}`}>{body}</article>
        </div>
      </div>
    </aside>
  );
}
