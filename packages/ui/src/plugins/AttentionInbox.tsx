import { type FocusEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellIcon } from "../chrome";
import type { AttentionItemView, AttentionView, HarnessClient } from "../client";
import { shownLanguage } from "../language";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];
/** "5 minutes ago", in the shown language; "" for a time that doesn't parse. */
function ago(iso: string, language: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const s = Math.round((at - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of UNITS) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  return rtf.format(0, "second");
}

/**
 * The Attention inbox (plugins spec §6): a bell in the top bar with main's unread count, opening a list. Everything
 * an item says comes from a plugin, so it is shown as plain text only, never as markup (B12). A click marks the item
 * read. An item with a target opens it instead (plugins part 2, Decision 12), and then only through what main answers
 * for it at click time (never built from item data): a panel through `onOpenPanel`, a prepared task through the surface.
 */
export function AttentionInbox({
  client,
  view,
  onOpenPanel,
}: {
  client: HarnessClient;
  view: AttentionView;
  /**
   * Opens a plugin's panel and passes `focus` to it (ChatView always passes it: a surface still on its way opens the
   * panel when it arrives). Absent, a panel target only closes the list: main said the panel exists, so it isn't gone.
   */
  onOpenPanel?: (plugin: string, panel: string, focus?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  /** The row a dismissed item had: focus stays there once main's new list arrives. */
  const refocus = useRef<number | null>(null);
  /** The item whose target main said is gone (its row says so), keyed like the rows. */
  const [gone, setGone] = useState<string | null>(null);
  /** An open is on its way to main: a second click (a double click) asks nothing more. */
  const opening = useRef(false);
  const lastBadge = useRef(view.badge);
  const id = useId();
  const language = shownLanguage(i18n);

  // Main's count is the badge (the UI never recounts); a rise is announced, the first load is not.
  useEffect(() => {
    if (view.badge > lastBadge.current) setAnnounce(t("plugins.attention.unread", { count: view.badge }));
    lastBadge.current = view.badge;
  }, [view.badge, t]);

  const focusRow = (index: number) => {
    const rows = dialog.current?.querySelectorAll<HTMLButtonElement>(".hh-pl-item-main");
    const row = rows && rows.length ? rows[Math.min(index, rows.length - 1)] : null;
    (row ?? dialog.current)?.focus();
  };
  useLayoutEffect(() => {
    if (open) focusRow(0);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || refocus.current === null) return;
    focusRow(refocus.current);
    refocus.current = null;
  }, [view.items, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    // Handled here: the panels' own Escape listeners skip it.
    e.preventDefault();
    close();
  };
  const openTarget = async (item: AttentionItemView, rowKey: string) => {
    if (opening.current) return;
    opening.current = true;
    setGone(null);
    let target;
    try {
      target = await client.attention.open(item.plugin, item.key);
    } catch {
      target = { kind: "none" } as const;
    } finally {
      opening.current = false;
    }
    if (target.kind === "panel") {
      onOpenPanel?.(target.plugin, target.panel, target.focus);
      setOpen(false);
    } else if (target.kind === "prepared") {
      // The card comes with main's surface push.
      close();
    } else {
      setGone(rowKey);
      setAnnounce(t("plugins.attention.gone"));
    }
  };
  const dismiss = (item: AttentionItemView, index: number) => {
    refocus.current = index;
    void client.attention.dismiss(item.plugin, item.key).catch(() => {
      // No new list comes: a later one must not pull focus back.
      refocus.current = null;
    });
  };
  // Focus moving elsewhere (Tab out) closes the list; a null target (a row removed, the window left) does not.
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget instanceof Node && !wrap.current?.contains(e.relatedTarget)) setOpen(false);
  };

  const unread = t("plugins.attention.unread", { count: view.badge });
  return (
    <div className="hh-pl-inbox" ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        className="hh-icon-button"
        aria-label={t("plugins.attention.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-describedby={view.badge > 0 ? `${id}-count` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BellIcon />
        {view.badge > 0 && (
          <>
            <span className="hh-pl-badge" aria-hidden="true">
              {view.badge}
            </span>
            <span id={`${id}-count`} className="hh-sr-only">
              {unread}
            </span>
          </>
        )}
      </button>
      <span className="hh-sr-only" aria-live="polite">
        {announce}
      </span>
      {open && (
        <div id={`${id}-list`} ref={dialog} className="hh-pl-popover" role="dialog" aria-label={t("plugins.attention.title")} tabIndex={-1}>
          {view.items.length === 0 ? (
            <p className="hh-pl-empty">{t("plugins.attention.empty")}</p>
          ) : (
            <ul className="hh-pl-items">
              {view.items.map((item, index) => {
                const titleId = `${id}-t-${index}`;
                const rowKey = `${item.plugin}\u0000${item.key}`;
                return (
                  <li key={rowKey} className="hh-pl-item" data-unread={!item.read}>
                    <button
                      className="hh-pl-item-main"
                      onClick={() =>
                        item.hasTarget ? void openTarget(item, rowKey) : void client.attention.read(item.plugin, item.key).catch(() => undefined)
                      }
                    >
                      <span className="hh-pl-dot" data-severity={item.severity} aria-hidden="true" />
                      <span className="hh-pl-item-text">
                        <span className="hh-pl-item-meta">
                          <span className="hh-sr-only">{t(`plugins.attention.severity.${item.severity}`)}</span>
                          {!item.read && <span className="hh-sr-only">{t("plugins.attention.unreadItem")}</span>}
                          <span dir="auto">{item.pluginName}</span>
                          <time dateTime={item.at} title={Number.isNaN(Date.parse(item.at)) ? undefined : new Date(item.at).toLocaleString(language)}>
                            {ago(item.at, language)}
                          </time>
                        </span>
                        <span id={titleId} className="hh-pl-item-title" dir="auto">
                          {item.title}
                        </span>
                        {item.body && <span className="hh-pl-item-body" dir="auto">{item.body}</span>}
                        {item.hasTarget && <span className="hh-pl-item-open">{t("plugins.attention.open")}</span>}
                        {gone === rowKey && (
                          <span className="hh-pl-item-gone">{t("plugins.attention.gone")}</span>
                        )}
                      </span>
                    </button>
                    <button className="hh-pl-dismiss" aria-describedby={titleId} onClick={() => dismiss(item, index)}>
                      {t("plugins.attention.dismiss")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
