import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DocumentKind, checkTemplate, readingMinutes, refusedShape, wordCount } from "@humanharness/harness-sdk/documents";
import { type AnswerPick, markOccurrence } from "@humanharness/harness-sdk/review";
import type { ApproveOptions, DocumentRead, HarnessClient, ReaderPrefs, ReviewResult, ReviewSendResult, ReviewView, TimelineEntry } from "./client";
import { ApprovedDiff } from "./ApprovedDiff";
import { Tag } from "./chrome";
import { DocumentContext, type DocumentHost } from "./documents-context";
import { EntryDiff } from "./EntryDiff";
import { FileTimeline } from "./FileTimeline";
import { FocusMarkers } from "./FocusMarkers";
import { Markdown, documentOutline } from "./markdown";
import { type BarDraft, NO_BAR_DRAFT, ReviewBar } from "./ReviewBar";
import { ReviewColumn } from "./ReviewColumn";
import { formatSize } from "./sizes";
import { type MarkSpec, clearMarks, drawMarks, findMarks } from "./review-marks";

/** What the reader shows: a document, the place to open at, and the agent of the turn that wrote it. */
export interface ReaderTarget {
  path: string;
  anchor?: string;
  agent?: string;
  /** New on every open, so opening the same document at the same anchor again still goes there. */
  nonce?: number;
  /** Open with the "File history" drawer (the History panel's link, file-timeline spec §6.2). */
  timeline?: boolean;
}

/** Over this the reader draws only the first `SHOWN_BYTES` (§6). */
const BIG_BYTES = 1024 * 1024;
const SHOWN_BYTES = 200 * 1024;

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
  /** The "File history" drawer (file-timeline spec §6.1), and the entry whose diff shows in place of the document. */
  const [drawer, setDrawer] = useState(target.timeline === true);
  const [picked, setPicked] = useState<TimelineEntry | null>(null);
  const drawerId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const drawerButton = useRef<HTMLButtonElement>(null);
  /** Where the document was (its heading at the top) when a diff took its place: back there on the way back. */
  const placeBeforeDiff = useRef<string | null>(null);
  const backFromDiff = useRef<string | null | undefined>(undefined);
  const pickedNow = useRef(picked);
  pickedNow.current = picked;
  /** The History panel's link: focus goes into the drawer, so the first Esc closes it, not the reader. */
  const focusDrawer = useRef(false);
  // The History panel's link opens the drawer, also on a document already shown.
  useEffect(() => {
    if (target.timeline !== true) return;
    setDrawer(true);
    focusDrawer.current = true;
  }, [path, target.nonce, target.timeline]);
  useEffect(() => {
    if (!drawer || !focusDrawer.current || !drawerRef.current) return;
    focusDrawer.current = false;
    drawerRef.current.focus({ preventScroll: true });
  }, [drawer, path, target.nonce]);
  // Focus mode hides the drawer and shows the document itself.
  useEffect(() => {
    if (inFocus) setPicked(null);
  }, [inFocus]);
  // A new entry's diff starts at its top.
  useEffect(() => {
    if (picked) scrollRef.current?.scrollTo?.({ top: 0 });
  }, [picked]);
  // Focus can fall to the page (the Approve button goes once pressed): Esc still leaves focus mode. A key the
  // reader already handled (its own onKeyDown prevents the default) is left alone.
  useEffect(() => {
    if (!inFocus || !onFocus) return;
    const leave = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onFocus(false);
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [inFocus, onFocus]);
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
    setPicked(null);
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
      // While a diff shows, the box holds the diff: the place to keep is the one saved when it opened.
      if (!pickedNow.current) restore.current = headingAtTop(scrollRef.current);
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
      // Opened with the drawer (the History panel's link): focus stays in the drawer.
      const inDrawer = target.timeline === true && drawerRef.current?.contains(document.activeElement) === true;
      if (!inDrawer) (titleRef.current ?? scrollRef.current)?.focus({ preventScroll: true });
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
    setRanges(box && doc?.ok && !source && !picked && marks.length > 0 ? findMarks(box, marks) : new Map());
    // `picked`: the text is drawn again on the way back from a diff, and its marks with it.
  }, [marks, doc, source, picked]);
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
    let r = sel.getRangeAt(0);
    if (!box.contains(r.commonAncestorContainer)) {
      // A triple click on the last paragraph selects up to the start of what follows the text: keep the part inside it.
      if (!box.contains(r.startContainer)) return setPick(null);
      r = r.cloneRange();
      r.setEnd(box, box.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    // The selection's text, not the range's: a range joins blocks with no space ("One.Two."), the selection puts line
    // breaks between them, as the reader shows them.
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
  /** Opens an entry's diff in place of the document, keeping the document's place for the way back. */
  const pickEntry = (e: TimelineEntry) => {
    if (!picked) placeBeforeDiff.current = headingAtTop(scrollRef.current);
    setPick(null);
    setDraft(null);
    setPicked(e);
  };
  /**
   * Back from an entry's diff to the document, at the place it had. Focus that was in the diff (or nowhere) goes to
   * the entry it came from (else the text); focus the person put elsewhere (a review card, the drawer) stays.
   */
  const leaveDiff = () => {
    const active = document.activeElement;
    const lost = active === null || active === document.body || scrollRef.current?.contains(active) === true;
    const from = drawerRef.current?.querySelector<HTMLElement>('.hh-timeline-pick[aria-current="true"]');
    backFromDiff.current = placeBeforeDiff.current;
    setPicked(null);
    if (lost) (from ?? scrollRef.current)?.focus({ preventScroll: true });
  };
  // The document drawn again after a diff: back to its place (the top when it had no heading above).
  useLayoutEffect(() => {
    if (picked || backFromDiff.current === undefined) return;
    const id = backFromDiff.current;
    backFromDiff.current = undefined;
    if (id) scrollToId(scrollRef.current, id);
    else scrollRef.current?.scrollTo?.({ top: 0 });
  }, [picked]);
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
    // An entry's diff (§6.1): back to the document first. The drawer closes only when focus is in it.
    else if (picked) leaveDiff();
    else if (drawer && !inFocus && drawerRef.current?.contains(document.activeElement)) {
      setDrawer(false);
      drawerButton.current?.focus();
    } else if (inFocus && onFocus) onFocus(false);
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
          {check?.unknownKind ? <Tag tone="gray">{t("reader.unknownKind")}</Tag> : front.kind && <Tag tone="gray">{front.kind}</Tag>}
          {front.status && <Tag tone="green">{front.status}</Tag>}
          {allowed && (
            <span className="hh-warn" role="note">
              {t("reader.badStatus", { allowed: allowed.join(", ") })}
            </span>
          )}
          <Tag tone="gray">{t("reader.minutes", { count: minutes })}</Tag>
          {target.agent && <Tag tone="gray">{t("reader.writtenBy", { agent: target.agent })}</Tag>}
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
  // Hidden while an entry's diff shows: approving acts on the document, which is not on screen then.
  const bar = review && !picked && doc?.ok && !source && rv?.ok && (
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
        <div className="hh-reader-head">
          <p className="hh-reader-head-title">{(doc?.ok && front.title) || crumbs.at(-1) || t("reader.title")}</p>
          <p className="hh-reader-head-sub">{t("reader.subtitle", { path })}</p>
        </div>
        <div className="hh-reader-actions">
          <button
            type="button"
            className="hh-pill"
            ref={prefsButton}
            aria-expanded={prefsOpen}
            aria-controls={prefsOpen ? prefsId : undefined}
            onClick={() => setPrefsOpen((o) => !o)}
          >
            Aa <span className="hh-sr-only">{t("reader.prefsButton")}</span>
          </button>
          <button
            type="button"
            ref={drawerButton}
            aria-pressed={drawer && !inFocus}
            aria-controls={drawer && !inFocus && !refused ? drawerId : undefined}
            disabled={refused}
            onClick={() => {
              // In focus mode the drawer is hidden (§6.1): the button leaves focus mode and opens it.
              if (inFocus && onFocus) {
                onFocus(false);
                setDrawer(true);
              } else setDrawer((d) => !d);
            }}
          >
            {t("timeline.open")}
          </button>
          {review && onFocus && (
            <button type="button" aria-pressed={inFocus} onClick={() => onFocus(!inFocus)}>
              {inFocus ? t("focus.leave") : t("focus.enter")}
            </button>
          )}
          {/* Back from full screen is the footer's Show chat (§5.7). */}
          {!inFocus && !full && (
            <button type="button" className="hh-pill" onClick={() => onFull(true)}>
              {t("reader.fullScreen")}
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
          {review && diffOpen && !picked && doc?.ok && !source && <ApprovedDiff client={client} path={path} refresh={doc.text} />}
          {picked ? (
            <EntryDiff client={client} path={path} entry={picked} busy={busy} onBack={leaveDiff} refresh={doc?.ok ? doc.text : undefined} />
          ) : (
            <article className={`hh-reader-doc hh-reader-${look.font}${look.size === "large" ? " hh-reader-large" : ""}`}>{body}</article>
          )}
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
          {review && pick && !picked && doc?.ok && !source && (
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
        {/* Only once opened: a reader without the drawer keeps its columns as they were. */}
        {drawer && !inFocus && !refused && (
          <section className="hh-timeline-drawer" id={drawerId} ref={drawerRef} tabIndex={-1} aria-label={t("timeline.title")}>
            <FileTimeline client={client} path={path} selected={picked?.to} onPick={pickEntry} />
          </section>
        )}
        {/* No column until the first comment (§6.1). */}
        {review && doc?.ok && !source && rv?.ok && rv.review && rv.review.comments.length > 0 && (!inFocus || peek !== null) && (
          <ReviewColumn
            review={inFocus ? { ...rv.review, comments: rv.review.comments.filter((c) => c.id === peek) } : rv.review}
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
      <footer className="hh-reader-foot">
        <nav aria-label={t("reader.path")}>
          <ol className="hh-reader-crumbs">
            {crumbs.map((c, i) => (
              <li key={i} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c}
              </li>
            ))}
          </ol>
        </nav>
        {doc?.ok && (
          <span className="hh-reader-changed">
            {t("reader.changed", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(doc.mtime)) })}
          </span>
        )}
        <div className="hh-reader-foot-actions">
          <button type="button" className="hh-pill" aria-pressed={source} disabled={!doc?.ok} onClick={() => setSource((s) => !s)}>
            {t("reader.source")}
          </button>
          {!inFocus && full && (
            <button type="button" className="hh-pill" onClick={() => onFull(false)}>
              {t("reader.showChat")}
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
