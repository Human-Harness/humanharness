import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

/** A drawer from the right (UI refresh spec §5.7): one at a time, on the rail's ground, over a scrim. */
export function Drawer({
  title,
  subtitle,
  actions,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // What had focus when the drawer opened gets it back when the drawer goes away.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
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
          if (e.key !== "Escape") return;
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
          <button type="button" className="hh-icon-button" aria-label={t("drawer.close")} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="hh-drawer-body">{children}</div>
      </div>
    </div>
  );
}
