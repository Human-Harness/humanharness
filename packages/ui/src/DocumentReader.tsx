import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DocumentKind, checkTemplate, readingMinutes, refusedShape, wordCount } from "@humanharness/harness-sdk/documents";
import { type AnswerPick, markOccurrence } from "@humanharness/harness-sdk/review";
import type { ApproveOptions, DocumentRead, HarnessClient, ReaderPrefs, ReviewResult, ReviewSendResult, ReviewView } from "./client";
import { ApprovedDiff } from "./ApprovedDiff";
import { DocumentContext, type DocumentHost } from "./documents-context";
import { FocusMarkers } from "./FocusMarkers";
import { Markdown, documentOutline } from "./markdown";
import { type BarDraft, NO_BAR_DRAFT, ReviewBar } from "./ReviewBar";
import { ReviewColumn } from "./ReviewColumn";
import { type MarkSpec, clearMarks, drawMarks, findMarks } from "./review-marks";

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
  review,
  busy = false,
  focus = false,
  onFocus,
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
  /** The harness's agent may edit the folder: the review column and marks (review spec §6.1). Absent: none (D0). */
  review?: boolean;
  /** A turn runs (or the task is saving its note): sending a review round waits (§5.3). */
  busy?: boolean;
  /** Focus mode (§6.2): one quiet column, no contents list; the comment column shows only a card a margin marker picked. */
  focus?: boolean;
  /** Enters or leaves focus mode; absent (or without `review`): no Focus button (D0). */
  onFocus?: (on: boolean) => void;
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
  /** Reads the drawn document again (set by the read effect): a review change may have swapped a passage. */
  const reread = useRef<(() => void) | null>(null);
  /** Loads the review view again (the latest `loadReview`; set below, once it is declared). */
  const reviewAgain = useRef<() => void>(() => {});
  const [nonce, setNonce] = useState(0);
  const [rv, setRv] = useState<ReviewView | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  /** A review action's problem, shown above the text. */
  const [notice, setNotice] = useState<string | null>(null);
  /** A selection in the text to comment on (§5.2), where its button goes, and the comment being written. */
  const [pick, setPick] = useState<{ selected: string; heading: string | null; top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const [ranges, setRanges] = useState<Map<string, Range>>(() => new Map());
  /** In focus mode, the card a margin marker opened (the column shows only it). */
  const [peek, setPeek] = useState<string | null>(null);
  // A new visit to focus mode starts with no card open.
  useEffect(() => setPeek(null), [focus]);
  const inFocus = review === true && focus;
  /** What the footer bar is in the middle of (a reason being typed): kept here, since the bar moves on a mode switch. */
  const barDraft = useState<BarDraft>(NO_BAR_DRAFT);
  const setBarDraft = barDraft[1];

  useEffect(() => {
    loaded.current = null;
    setDoc(null);
    setSource(false);
    setCurrent(null);
    setRv(null);
    setActive(null);
    setWaiting(null);
    setNotice(null);
    setPick(null);
    setDraft(null);
    setDiffOpen(false);
    setPeek(null);
    setBarDraft(NO_BAR_DRAFT);
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
    // The text changed (on disk, or by a swap): its review view too, so an approval turns stale and approve sends the new blob.
    const again = () => {
      restore.current = headingAtTop(scrollRef.current);
      read();
      reviewAgain.current();
    };
    const off = client.watchDocument(path, again);
    reread.current = again;
    return () => {
      live = false;
      reread.current = null;
      off();
    };
  }, [client, path, refused]);

  // A review change: the record again, and the document too (an answer may have swapped a passage).
  useEffect(() => {
    if (nonce > 0) reread.current?.();
  }, [nonce]);
  // Only the latest view of the document shown now draws: a late answer for another path is dropped.
  const pathNow = useRef(path);
  pathNow.current = path;
  const reviewSeq = useRef(0);
  const loadReview = useCallback(() => {
    if (!review || refused) return;
    const want = path;
    const mine = ++reviewSeq.current;
    const done = (v: ReviewView) => {
      if (mine !== reviewSeq.current || pathNow.current !== want) return;
      if (v.ok && v.review && v.review.path !== want) return;
      setRv(v);
    };
    client.documents.view(want).then(done, () => done({ ok: false, reason: "not-ready" }));
  }, [client, path, review, refused]);
  reviewAgain.current = loadReview;
  useEffect(() => {
    if (!review || refused) return;
    loadReview();
    // `reread` (through the nonce) reads the text and the view again.
    const off = client.documents.onChange((p) => {
      if (p === path) setNonce((n) => n + 1);
    });
    return () => {
      reviewSeq.current++;
      off();
    };
  }, [client, path, review, refused, loadReview]);

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
  const record = review && rv?.ok ? rv.review : null;
  const marks = useMemo(() => {
    const out: MarkSpec[] = [];
    for (const c of record?.comments ?? []) {
      const m = markOccurrence(shown, c.anchor);
      if (m) out.push({ id: c.id, want: m.want, nth: m.nth, tone: c.state === "resolved" ? "done" : c.kind === "question" ? "question" : "comment" });
    }
    return out;
  }, [record, shown]);
  // Marks are found in the rendered body only, once it is in the DOM; hovering a card only redraws (below).
  useLayoutEffect(() => {
    const box = textRef.current;
    setRanges(box && doc?.ok && !source && marks.length > 0 ? findMarks(box, marks) : new Map());
  }, [marks, doc, source]);
  // The CSS Custom Highlight API: no DOM change, no CSP change.
  useLayoutEffect(() => {
    if (ranges.size === 0) {
      clearMarks();
      return;
    }
    drawMarks(ranges, marks, active);
    return clearMarks;
  }, [ranges, marks, active]);
  const act = async (call: () => Promise<ReviewResult>, id?: string) => {
    const want = path;
    if (id) setWaiting(id);
    const r = await call().catch((): ReviewResult => ({ ok: false, reason: "not-ready" }));
    // Another document is shown now: this answer is not its.
    if (pathNow.current !== want) return;
    if (id) setWaiting(null);
    setNotice(r.ok ? null : r.reason === "not-found" ? t("review.notFound") : t("review.failed"));
    loadReview();
  };
  const answer = (id: string, pick: AnswerPick) => act(() => client.documents.answer(path, id, pick), id);
  const editDraft = (id: string, value: string | null) => act(() => client.documents.editDraft(path, id, value));
  const reopen = (id: string) => act(() => client.documents.reopen(path, id));
  /** The id of the heading above `node`, inside the review text (the reader's slugs). */
  const headingAbove = (node: Node): string | null => {
    const box = textRef.current;
    if (!box) return null;
    let found: string | null = null;
    for (const h of box.querySelectorAll<HTMLElement>("[data-heading]")) {
      if (h.contains(node) || h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = h.id || found;
      else break;
    }
    return found;
  };
  /**
   * A selection inside the rendered text offers "Comment" below it; anything else closes the offer.
   * Known gap: selecting needs a pointer (or the system's own text selection keys once focus is in the text); the
   * reader has no caret mode of its own, so a keyboard-only person comments through the agent's questions only.
   */
  const onSelect = () => {
    if (draft !== null) return;
    const sel = window.getSelection();
    const box = textRef.current;
    const scroller = scrollRef.current;
    if (!review || !sel || sel.isCollapsed || sel.rangeCount === 0 || !box || !scroller) return setPick(null);
    const r = sel.getRangeAt(0);
    if (!box.contains(r.commonAncestorContainer)) return setPick(null);
    const selected = sel.toString();
    if (!selected.trim() || selected.length > 20_000) return setPick(null);
    const rect = r.getBoundingClientRect();
    const host = scroller.getBoundingClientRect();
    setPick({ selected, heading: headingAbove(r.startContainer), top: rect.bottom - host.top + scroller.scrollTop, left: Math.max(0, rect.left - host.left) });
  };
  /** Closes the offer; focus goes back to the text, never lost to the page when its box unmounts. */
  const closePick = () => {
    setPick(null);
    setDraft(null);
    scrollRef.current?.focus({ preventScroll: true });
  };
  const saveDraft = () => {
    const text = draft?.trim();
    if (!pick || !text) return;
    const { selected, heading } = pick;
    closePick();
    void act(() => client.documents.comment(path, { selected, heading, text }));
  };
  const pickCard = (id: string, scroll?: boolean) => {
    setActive(id);
    if (scroll) ranges.get(id)?.startContainer.parentElement?.scrollIntoView?.({ block: "center" });
  };
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
    if (pick) closePick();
    else if (prefsOpen) {
      setPrefsOpen(false);
      prefsButton.current?.focus();
    } else if (inFocus && peek) {
      // Focus was in the card, which goes: it moves to the card's marker (else the text), never lost to the page.
      const inCard = document.activeElement?.closest(".hh-review-column") != null;
      setPeek(null);
      if (inCard) {
        const marker = scrollRef.current?.querySelector<HTMLElement>(`.hh-focus-marker[data-comment="${CSS.escape(peek)}"]`);
        (marker ?? scrollRef.current)?.focus({ preventScroll: true });
      }
    }
    else if (inFocus && onFocus) onFocus(false);
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
          <h1 className="hh-reader-title" tabIndex={-1} ref={titleRef}>
            {front.title}
          </h1>
        )}
        <DocumentContext.Provider value={host}>
          {review ? (
            <div className="hh-review-text" ref={textRef} onMouseUp={onSelect} onKeyUp={onSelect}>
              <Markdown source={shown} document path={path} idPrefix="" />
            </div>
          ) : (
            <Markdown source={shown} document path={path} idPrefix="" />
          )}
        </DocumentContext.Provider>
        {big && (
          <p className="hh-reader-truncated" role="note">
            {t("reader.truncated", { shown: formatSize(SHOWN_BYTES), size: formatSize(doc.size) })}
          </p>
        )}
      </>
    );
  }

  // The footer bar (§5.3, §5.4): under the columns, or in focus mode the last thing in the document column.
  const bar = review && doc?.ok && !source && rv?.ok && (
    <ReviewBar
      key={path}
      summary={rv.summary}
      busy={busy}
      approvedReason={rv.review?.approvals.at(-1)?.reason}
      changesOpen={diffOpen}
      onSend={async () => {
        const want = path;
        const r = await client.documents.send(want).catch((): ReviewSendResult => ({ ok: false, reason: "not-ready" }));
        if (pathNow.current === want) loadReview();
        return r;
      }}
      onApprove={async (reason, opts) => {
        const want = path;
        // The version shown: a document changed since is refused with "changed".
        const o: ApproveOptions = { ...(reason !== undefined ? { reason } : {}), ...(opts?.discard ? { discard: true } : {}) };
        const r = await client.documents.approve(want, rv.blob, o).catch((): ReviewResult => ({ ok: false, reason: "not-ready" }));
        if (pathNow.current === want) {
          if (r.ok) setDiffOpen(false);
          loadReview();
        }
        return r;
      }}
      onSeeChanges={() => setDiffOpen((o) => !o)}
      draft={barDraft}
    />
  );

  return (
    <aside className={`hh-reader${full ? " hh-reader-is-full" : ""}${review ? " hh-reader-reviewing" : ""}${inFocus ? " hh-reader-focus" : ""}`} aria-label={t("reader.title")} onKeyDown={onKeyDown}>
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
          {review && onFocus && (
            <button type="button" aria-pressed={inFocus} onClick={() => onFocus(!inFocus)}>
              {inFocus ? t("focus.leave") : t("focus.enter")}
            </button>
          )}
          {!inFocus && (
            <button type="button" onClick={() => onFull(!full)}>
              {full ? t("reader.showChat") : t("reader.fullScreen")}
            </button>
          )}
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
        {!inFocus && doc?.ok && !source && (outline.length > 0 || (check && check.missing.length > 0)) && (
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
          {review && rv && !rv.ok && rv.reason === "broken" && (
            <p className="hh-reader-problem hh-review-note" role="alert">
              {t("review.broken", { file: `.harness/reviews/${path}.json` })}
            </p>
          )}
          {review && notice && (
            <p className="hh-warn hh-review-note" role="alert">
              {notice}
            </p>
          )}
          {review && diffOpen && doc?.ok && !source && <ApprovedDiff client={client} path={path} current={doc.text} />}
          <article className={`hh-reader-doc hh-reader-${look.font}${look.size === "large" ? " hh-reader-large" : ""}`}>{body}</article>
          {inFocus && bar}
          {inFocus && doc?.ok && !source && rv?.ok && rv.review && (
            <FocusMarkers
              comments={rv.review.comments}
              ranges={ranges}
              host={scrollRef.current}
              look={`${look.font} ${look.size}`}
              open={peek}
              onPick={(id) => {
                setPeek(id);
                setActive(id);
              }}
            />
          )}
          {review && pick && doc?.ok && !source && (
            // The place goes through React's style (CSSOM): the CSP stays as it is.
            <div className="hh-review-pick" style={{ top: pick.top, left: pick.left }}>
              {draft === null ? (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft("")}>
                  {t("review.comment")}
                </button>
              ) : (
                <>
                  <textarea aria-label={t("review.commentLabel")} autoFocus value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
                  <button type="button" disabled={!draft.trim()} onClick={saveDraft}>
                    {t("review.saveDraft")}
                  </button>
                  <button type="button" onClick={closePick}>
                    {t("review.cancel")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {review && doc?.ok && !source && rv?.ok && (!inFocus || (peek !== null && rv.review)) && (
          <ReviewColumn
            review={
              inFocus && rv.review
                ? { ...rv.review, comments: rv.review.comments.filter((c) => c.id === peek) }
                : (rv.review ?? { path, task: null, comments: [], approvals: [] })
            }
            text={doc.text}
            agent={target.agent ?? ""}
            locked={rv.summary.status === "approved"}
            waiting={waiting}
            active={active}
            onActive={pickCard}
            onAnswer={answer}
            onEditDraft={editDraft}
            onReopen={reopen}
          />
        )}
      </div>
      {!inFocus && bar}
    </aside>
  );
}
