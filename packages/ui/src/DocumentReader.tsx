import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  /** New on every open, so opening the same document at the same anchor again still goes there. */
  nonce?: number;
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

/** Scrolls to a heading of this document only: its ids have no prefix, so the rest of the window is never searched. */
function scrollToId(box: HTMLElement | null, id: string) {
  const el = box?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  el?.scrollIntoView?.({ block: "start" });
}

/** The longest start of `text` whose UTF-8 encoding fits in `bytes` (never half a character). */
export function cutToBytes(text: string, bytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= bytes) return text;
  let end = bytes;
  // Back up to the start of a character: continuation bytes are 10xxxxxx.
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.subarray(0, end));
}

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
  onMissing,
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
  /** The document is not there (moved or deleted): the chat checks its cards again. */
  onMissing?: () => void;
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  const prefsButton = useRef<HTMLButtonElement>(null);
  const prefsId = useId();
  /** Where to scroll once the next text is drawn: the anchor asked for, or the heading kept across a reload. */
  const restore = useRef<string | null>(null);
  /** The path whose text is drawn now (null while another one loads). */
  const loaded = useRef<string | null>(null);
  /** The path the reader last took focus for: once per document, never on a reload. */
  const focused = useRef<string | null>(null);
  // The target may come from a harness's own UI (`client.openDocument`): never trust its shape.
  const path = typeof target.path === "string" ? target.path : "";
  const refused = refusedShape(target.path);
  const anchor = typeof target.anchor === "string" && target.anchor ? target.anchor : undefined;

  useEffect(() => {
    loaded.current = null;
    setDoc(null);
    setSource(false);
    setCurrent(null);
    if (refused) {
      setDoc({ ok: false, reason: "outside" });
      return;
    }
    let live = true;
    // Only the latest read draws: an older answer arriving late is dropped.
    let seq = 0;
    const read = () => {
      const mine = ++seq;
      const done = (d: DocumentRead) => {
        if (!live || mine !== seq) return;
        loaded.current = path;
        setDoc(d);
      };
      client.readDocument(path).then(done, () => done({ ok: false, reason: "missing" }));
    };
    read();
    const off = client.watchDocument(path, () => {
      restore.current = headingAtTop(scrollRef.current);
      read();
    });
    return () => {
      live = false;
      off();
    };
  }, [client, path, refused]);

  // Declared after the read: on a path change `loaded` is already reset, so the anchor waits for the new text.
  // Also a new anchor (or the same one opened again) in the document already drawn: go there now.
  useEffect(() => {
    if (loaded.current === path && doc?.ok) {
      if (anchor) scrollToId(scrollRef.current, anchor);
    } else restore.current = anchor ?? null;
    // `doc` is read, not watched: only a new target moves the place here.
  }, [path, anchor, target.nonce]);

  useLayoutEffect(() => {
    if (!doc?.ok) return;
    if (focused.current !== path) {
      focused.current = path;
      (titleRef.current ?? scrollRef.current)?.focus({ preventScroll: true });
    }
    const id = restore.current;
    if (!id) return;
    restore.current = null;
    scrollToId(scrollRef.current, id);
  }, [doc, path]);

  const missingRef = useRef(onMissing);
  missingRef.current = onMissing;
  useEffect(() => {
    if (doc && !doc.ok && doc.reason === "missing") missingRef.current?.();
  }, [doc]);

  const text = doc?.ok ? doc.text : "";
  const big = doc?.ok === true && doc.size > BIG_BYTES;
  const shown = useMemo(() => (big ? cutToBytes(text, SHOWN_BYTES) : text), [big, text]);
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
    if (prefsOpen) {
      setPrefsOpen(false);
      prefsButton.current?.focus();
    } else onClose();
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
          <h1 className="hh-reader-title" tabIndex={-1} ref={titleRef}>
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
          <button
            type="button"
            ref={prefsButton}
            aria-expanded={prefsOpen}
            aria-controls={prefsOpen ? prefsId : undefined}
            onClick={() => setPrefsOpen((o) => !o)}
          >
            Aa <span className="hh-sr-only">{t("reader.prefsButton")}</span>
          </button>
          <button type="button" onClick={() => onFull(!full)}>
            {full ? t("reader.showChat") : t("reader.fullScreen")}
          </button>
          <button type="button" onClick={onClose}>
            {t("reader.close")}
          </button>
        </div>
        {prefsOpen && (
          <div className="hh-reader-prefs" id={prefsId} role="group" aria-label={t("reader.prefs")}>
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
                      scrollToId(scrollRef.current, h.id);
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
        <div className="hh-reader-scroll" ref={scrollRef} tabIndex={-1} onScroll={() => setCurrent(headingAtTop(scrollRef.current))}>
          <article className={`hh-reader-doc hh-reader-${look.font}${look.size === "large" ? " hh-reader-large" : ""}`}>{body}</article>
        </div>
      </div>
    </aside>
  );
}
