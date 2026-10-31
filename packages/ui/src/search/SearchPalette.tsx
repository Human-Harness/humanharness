import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SearchAnswer, SearchFilters, SearchHitView, SearchKind, SearchMarked, SearchStatus } from "../client";
import { questionText } from "./ask";
import { type Section, chipsOf, rowsOf, sectionsOf, step } from "./model";

const QUERY_DELAY_MS = 80;
const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
/** "⌘" on macOS, "Ctrl+" elsewhere. */
export const MOD = MAC ? "⌘" : "Ctrl+";
/** ⌘ on macOS, Ctrl elsewhere, not both. */
export const isMod = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

function Marked({ parts }: { parts: SearchMarked }) {
  return (
    <>
      {parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** Focus stays inside the dialog (§5.1): Tab from the last control goes to the first, and back. */
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>("input, button")].filter((el) => !el.hasAttribute("disabled"));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function HitRow({ id, hit, active, onPick, onHover }: { id: string; hit: SearchHitView; active: boolean; onPick: () => void; onHover: () => void }) {
  const { t } = useTranslation();
  const meta = hit.meta
    ? [hit.meta.role ? t(`search.role.${hit.meta.role}`) : null, hit.meta.status ? t(`search.status.${hit.meta.status}`) : null, hit.meta.tier ?? null].filter(Boolean).join(" · ")
    : "";
  return (
    // The input keeps focus (aria-activedescendant): a press on a row never moves it.
    <div id={id} role="option" aria-selected={active} className={active ? "hh-search-row hh-search-row-active" : "hh-search-row"} onMouseDown={(e) => e.preventDefault()} onMouseMove={onHover} onClick={onPick}>
      <span className={`hh-search-icon hh-search-icon-${hit.kind}`} aria-hidden="true" />
      <span className="hh-search-text">
        <span className="hh-search-row-title">
          <Marked parts={hit.title} />
        </span>
        <span className="hh-search-row-context">{hit.context.length > 0 ? <Marked parts={hit.context} /> : meta}</span>
      </span>
      {hit.folder !== undefined && <span className="hh-search-tag">{t("search.readOnly", { folder: hit.folder })}</span>}
      {hit.scope !== undefined && <span className="hh-search-tag">{hit.scope}</span>}
    </div>
  );
}

export interface SearchPaletteProps {
  client: HarnessClient;
  initialQuery?: string;
  /** The footer's "Searching in <harness>" or "<scope> + app". */
  where: string;
  /** A harness with scopes: the "All <plural>" toggle shows (D2). */
  scopesPlural?: string;
  /** A harness with reference folders: their toggle shows, on by default. */
  references: boolean;
  onClose: () => void;
  onPick: (hit: SearchHitView) => void;
  onAsk: (text: string) => void;
}

/** The ⌘K palette (search spec §5): a modal dialog with a combobox over a grouped listbox. Asks main; sends nothing. */
export function SearchPalette({ client, initialQuery = "", where, scopesPlural, references, onClose, onPick, onAsk }: SearchPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<SearchKind | null>(null);
  /** Null until the person flips it: main's remembered value shows meanwhile. */
  const [allScopes, setAllScopes] = useState<boolean | null>(null);
  const [refs, setRefs] = useState(true);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [active, setActive] = useState(0);
  const asked = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  useEffect(() => client.search.onStatus(setStatus), [client]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Every change asks again (typing after a short pause); only the latest answer is kept.
  useEffect(() => {
    const n = ++asked.current;
    const filters: SearchFilters = { ...(kind ? { kind } : {}), ...(allScopes !== null ? { allScopes } : {}), ...(refs ? {} : { references: false }) };
    const timer = setTimeout(
      () => {
        void client.search.query(query, filters).then((a) => {
          if (n !== asked.current) return;
          setAnswer(a);
          setActive(0);
          if (a.ok) setStatus(a.status);
        });
      },
      query.trim() ? QUERY_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [client, query, kind, allScopes, refs]);

  const sections = sectionsOf(answer);
  const rows = rowsOf(sections);
  const chips = chipsOf(answer);
  const shownAll = allScopes ?? (answer?.ok ? answer.allScopes : false);
  const optionId = (i: number) => `${ids}-o${i}`;
  const typed = query.trim() !== "";

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") trapTab(e, dialogRef.current);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => step(i, e.key === "ArrowDown" ? 1 : -1, rows.length));
    } else if (e.key === "Enter" && isMod(e)) {
      e.preventDefault();
      const text = questionText(query, rows, t);
      if (text) onAsk(text);
    } else if (e.key === "Enter" && e.target === inputRef.current) {
      // Enter on a chip or a toggle presses it; only the input's Enter opens the active row.
      e.preventDefault();
      if (rows[active]) onPick(rows[active]);
    } else if (isMod(e) && /^[1-7]$/.test(e.key)) {
      const chip = chips[Number(e.key) - 1];
      if (chip) {
        e.preventDefault();
        setKind(chip.kind);
      }
    }
  };

  const message = !answer
    ? null
    : !answer.ok
      ? t(answer.reason === "not-ready" ? "search.notReady" : "search.failed")
      : rows.length > 0
        ? null
        : typed
          ? t("search.none", { query: query.trim() })
          : t("search.empty", { mod: MOD });
  const sectionLabel = (key: Section["key"]) => (key === "recent" ? t("search.recent") : t(`search.kind.${key}`));
  let index = 0;

  return (
    <div
      className="hh-search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="hh-search" role="dialog" aria-modal="true" aria-label={t("search.title")} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="hh-search-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={`${ids}-list`}
          aria-activedescendant={rows[active] ? optionId(active) : undefined}
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(chips.length > 0 || scopesPlural || references) && (
          <div className="hh-search-filters" role="group" aria-label={t("search.filters")}>
            {chips.map((c) => (
              <button key={c.kind ?? "all"} type="button" className="hh-search-chip" aria-pressed={kind === c.kind} onClick={() => setKind(c.kind)}>
                {c.kind ? t(`search.kind.${c.kind}`) : t("search.all")} <span className="hh-search-chip-count">{c.count}</span>
              </button>
            ))}
            {scopesPlural && (
              <label className="hh-search-toggle">
                <input type="checkbox" checked={shownAll} onChange={(e) => setAllScopes(e.target.checked)} /> {t("search.allScopes", { plural: scopesPlural })}
              </label>
            )}
            {references && (
              <label className="hh-search-toggle">
                <input type="checkbox" checked={refs} onChange={(e) => setRefs(e.target.checked)} /> {t("search.references")}
              </label>
            )}
          </div>
        )}
        {status && (status.state === "names" || status.state === "building") && (
          <p className="hh-search-note" role="status">
            {status.state === "building" ? t("search.indexing", { done: status.done, total: status.total }) : t("search.indexingNames")}
          </p>
        )}
        {status?.truncated && <p className="hh-search-note">{t("search.truncated")}</p>}
        {answer?.ok && answer.partial && <p className="hh-search-note">{t("search.partial")}</p>}
        <div id={`${ids}-list`} className="hh-search-list" role="listbox" aria-label={t("search.results")}>
          {sections.map((s) => (
            <div key={s.key} role="group" aria-label={sectionLabel(s.key)} className="hh-search-section">
              <div className="hh-search-section-label" aria-hidden="true">
                {sectionLabel(s.key)}
              </div>
              {s.hits.map((hit) => {
                const i = index++;
                return <HitRow key={hit.id} id={optionId(i)} hit={hit} active={i === active} onPick={() => onPick(hit)} onHover={() => setActive(i)} />;
              })}
            </div>
          ))}
        </div>
        {message && <p className="hh-search-empty">{message}</p>}
        <div className="hh-sr-only" aria-live="polite">
          {answer?.ok && typed ? t("search.count", { count: rows.length }) : ""}
        </div>
        <div className="hh-search-footer">
          <span>{t("search.keys.move")}</span>
          <span>{t("search.keys.open")}</span>
          <span>{t("search.keys.ask", { mod: MOD })}</span>
          <span>{t("search.keys.close")}</span>
          <span className="hh-search-where">{where}</span>
        </div>
      </div>
    </div>
  );
}
