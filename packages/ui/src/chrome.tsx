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
  describedBy,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Ids of the texts that describe the group (help, an error). */
  describedBy?: string;
}) {
  return (
    <div className="hh-segmented" role="group" aria-label={label} aria-describedby={describedBy}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The top-bar Sidekick switch (sidekick spec §7): a state dot, filled when on. */
export function SidekickToggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="hh-sk-toggle" data-on={on} aria-label={label} onClick={onToggle}>
      <span className="hh-sk-dot" aria-hidden="true" />
      {t("sidekick.toggle")}
    </button>
  );
}

/** Settings: a line gear (path from Lucide's "settings" icon, ISC license). */
export type TagTone = "green" | "orange" | "blue" | "violet" | "red" | "gray";

/** A state, coloured by what it means (UI refresh spec §3.3): green done, orange now/waiting, blue info, violet deep/suggestion, red failed, gray neutral. */
export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return <span className={`hh-tag hh-tag-${tone}`}>{children}</span>;
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** An engine without a logo (the test engine): a generic screen. */
export function EngineIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
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

/** Closes a panel. */
export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** A row that opens (points down when open). */
export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** Undoing: going back. */
export function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5L4 10l5 5" />
      <path d="M4 10h11a5 5 0 0 1 0 10h-4" />
    </svg>
  );
}

/** Time: the history, or waiting for the AI. */
export function ClockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Something that can't be taken back. */
export function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

/** The Attention inbox: a line bell (paths from Lucide's "bell" icon, ISC license). */
export function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.27 21a2 2 0 0 0 3.46 0" />
      <path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33" />
    </svg>
  );
}
