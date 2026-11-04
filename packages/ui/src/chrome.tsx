import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "./guide/icons";
import type { RailEntry } from "./shell-nav";
import { IconButton } from "./guide/IconButton";

export function MockBadge() {
  const { t } = useTranslation();
  return (
    <span className="hh-mock-badge" role="note">
      {t("mock.badge")}
    </span>
  );
}

export interface Crumb {
  label: string;
  onClick?: () => void;
}

/**
 * The window's top bar (UI refresh spec §4.1): the drag region of the hiddenInset title bar, 80px left for the traffic
 * lights, then the breadcrumb, the centre slot (search) and the trailing controls. No logo: the traffic lights sit
 * there. `title` is the bar before the breadcrumb: a heading shown only when there are no crumbs, kept until every
 * screen passes crumbs.
 */
export function TopBar({
  crumbs = [],
  title,
  leading,
  mock,
  center,
  trailing,
  children,
}: {
  crumbs?: Crumb[];
  title?: ReactNode;
  /** In place of crumbs or title: Settings' Volver (DESIGN.md "Settings"). */
  leading?: ReactNode;
  mock?: boolean;
  center?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <header className="hh-topbar">
      {crumbs.length > 0 ? (
        <nav className="hh-crumbs" aria-label={t("app.breadcrumb")}>
          {/* Labels come from the manifest and the task (untrusted): dir="auto" isolates each, so RTL text or bidi
              controls in one can't reorder the others. */}
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span aria-hidden="true" className="hh-crumb-sep">
                  /
                </span>
              )}
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="hh-crumb-here" dir="auto">
                  {c.label}
                </span>
              ) : (
                <button type="button" className="hh-crumb" dir="auto" onClick={c.onClick}>
                  {c.label}
                </button>
              )}
            </Fragment>
          ))}
        </nav>
      ) : leading !== undefined ? (
        leading
      ) : (
        title !== undefined && <h1 className="hh-title">{title}</h1>
      )}
      {/* humanharness dev --mock: a fake engine answers, so the tester never takes it for the real thing. */}
      {mock && <MockBadge />}
      <span className="hh-spacer">{center}</span>
      {trailing}
      {children}
    </header>
  );
}

/** The window's bottom strip (Home, setup): the wordmark, the work folder, and the test-mode badge at the right. */
export function AppFooter({ folder, mock }: { folder?: string | undefined; mock?: boolean | undefined }) {
  return (
    <footer className="hh-footer">
      <span className="hh-wordmark">Human Harness</span>
      {folder && (
        <span className="hh-footer-path" title={folder}>
          <bdi dir="ltr">{folder}</bdi>
        </span>
      )}
      {mock && <MockBadge />}
    </footer>
  );
}

/** The task header's Sidekick pill (sidekick spec §7, UI refresh spec §5.1): a state dot, green when on. */
export function SidekickToggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="hh-sk-toggle hh-pill" data-on={on} aria-label={label} onClick={onToggle}>
      <span className="hh-dot" aria-hidden="true" />
      {t("sidekick.toggle")}
    </button>
  );
}

export type TagTone = "green" | "orange" | "blue" | "violet" | "red" | "gray";

/** A state, coloured by what it means (UI refresh spec §3.3): green done, orange now/waiting, blue info, violet deep/suggestion, red failed, gray neutral. */
export function Tag({ tone, children, id, title }: { tone: TagTone; children: ReactNode; id?: string; title?: string }) {
  return (
    <span className={`hh-tag hh-tag-${tone}`} id={id} title={title}>
      {children}
    </span>
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

/** Settings' gear: the bare icon at the top bar's right on every screen (Home, work, setup), where Settings' own save sits. */
export function SettingsGear({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <IconButton icon="settings" label={t("home.settings")} size="compact" onClick={onClick} />
  );
}

const RAIL_ICONS: Record<RailEntry, IconName> = {
  home: "home",
  tasks: "tasks",
  inbox: "inbox",
  jobs: "jobs",
  notes: "files",
  plugins: "plugins",
  settings: "settings",
};

/** The icon rail (UI refresh spec §4.2): the screens of a harness. Settings is the top bar's gear, not a rail entry. */
export function Rail({ entries, current, onPick }: { entries: RailEntry[]; current: RailEntry; onPick: (e: RailEntry) => void }) {
  const { t } = useTranslation();
  const button = (e: RailEntry) => (
    <IconButton key={e} icon={RAIL_ICONS[e]} label={t(`rail.${e}`)} aria-current={e === current ? "page" : undefined} onClick={() => onPick(e)} />
  );
  return (
    <nav className="hh-rail" aria-label={t("rail.label")}>
      {entries.filter((e) => e !== "settings").map(button)}
    </nav>
  );
}
