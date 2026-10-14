import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

function MockBadge() {
  const { t } = useTranslation();
  return (
    <span className="hh-mock-badge" role="note">
      {t("mock.badge")}
    </span>
  );
}

/** The window's top bar: the drag region of the hiddenInset title bar, with room for the traffic lights. */
export function TopBar({ title, mock, children }: { title?: ReactNode; mock?: boolean; children?: ReactNode }) {
  return (
    <header className="hh-topbar">
      {title !== undefined && <h1 className="hh-title">{title}</h1>}
      {/* humanharness dev --mock: a fake engine answers, so the tester never takes it for the real thing. */}
      {mock && <MockBadge />}
      <span className="hh-spacer" />
      {children}
    </header>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** macOS-style segmented control: one choice among a few. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="hh-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.6 1h2.8l.4 1.9 1.3.6 1.7-1 2 2-1 1.7.6 1.3 1.9.4v2.8l-1.9.4-.6 1.3 1 1.7-2 2-1.7-1-1.3.6-.4 1.9H6.6l-.4-1.9-1.3-.6-1.7 1-2-2 1-1.7-.6-1.3L0 9.4V6.6l1.9-.4.6-1.3-1-1.7 2-2 1.7 1 1.3-.6zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
      />
    </svg>
  );
}

/**
 * The Human Harness H (beveled, charcoal on paper): a vector stand-in for `hh.logo.jpeg` until the
 * designer's file arrives. It takes the ink colour, so it also works in dark mode.
 */
export function HHLogo({ className = "", title }: { className?: string; title?: string }) {
  return (
    <svg
      className={`hh-logo ${className}`.trim()}
      viewBox="0 0 1000 1000"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <polygon fill="currentColor" points="182,155 357,155 357,453 655,453 655,155 830,155 830,870 655,870 655,597 357,597 357,870 182,870" />
      <g fill="#ffffff" fillOpacity="0.12">
        <polygon points="182,155 357,155 270,195 270,830 182,870" />
        <polygon points="270,523 357,453 655,453 742,523" />
        <polygon points="655,155 830,155 742,195 742,523 655,453" />
        <polygon points="655,597 742,523 742,830 655,870" />
      </g>
    </svg>
  );
}

/** A done step or topic. */
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** A read-only folder. */
export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** A saved note. */
export function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 4h11l3 3v13H5z" />
    </svg>
  );
}
