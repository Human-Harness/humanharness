import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

/** A drawer from the right (UI refresh spec §5.7): one at a time, on the rail's ground, over a scrim. */
export function Drawer({
  title,
  subtitle,
  actions,
  wide = false,
  focusClose = false,
  onKeyDown,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  wide?: boolean;
  /** Focus goes to Close on open instead of the dialog itself (the panels that did so before the drawer). */
  focusClose?: boolean;
  /** Heard first: a key it marks handled (`preventDefault`) is left alone, Escape included. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // What had focus when the drawer opened gets it back when the drawer goes away.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    (focusClose ? closeRef.current : ref.current)?.focus();
    return () => {
      // Only when focus went away with the drawer: a panel that already gave it back (or another drawer that took
      // it) keeps it.
      const active = document.activeElement;
      const lost = !active || active === document.body || Boolean(node?.contains(active));
      if (lost && opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div className="hh-drawer-layer">
      <div className="hh-drawer-scrim" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={wide ? "hh-drawer hh-drawer-wide" : "hh-drawer"}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key !== "Escape" || e.defaultPrevented) return;
          // Marked handled, so focus mode's window listener does not also leave.
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <header className="hh-drawer-head">
          <div className="hh-drawer-titles">
            <h2 id={id}>{title}</h2>
            {subtitle && <span className="hh-caption">{subtitle}</span>}
          </div>
          {actions}
          <button ref={closeRef} type="button" className="hh-icon-button" aria-label={t("drawer.close")} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="hh-drawer-body">{children}</div>
      </div>
    </div>
  );
}
