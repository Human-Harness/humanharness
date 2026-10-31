import type { ReactNode } from "react";

/**
 * A Settings section's head (UI refresh spec §5.5): title, what it is for and when a change applies, and an optional
 * control (Sidekick's main switch). `lineId` lets that control be described by the line.
 */
export function SectionHead({ title, line, aside, lineId }: { title: string; line: string; aside?: ReactNode; lineId?: string }) {
  return (
    <header className="hh-section-head">
      <div>
        <h2>{title}</h2>
        <p className="hh-caption" id={lineId}>
          {line}
        </p>
      </div>
      {aside}
    </header>
  );
}

/**
 * A card of rows inside a section, with an optional title and actions on its head. `headingId` gives the title an id,
 * so a region around the card can be named by it.
 */
export function SettingsCard({
  title,
  children,
  actions,
  headingId,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  headingId?: string;
  className?: string;
}) {
  return (
    <section className={className ? `hh-card hh-settings-card ${className}` : "hh-card hh-settings-card"}>
      {(title || actions) && (
        <div className="hh-settings-card-head">
          {title && <h3 id={headingId}>{title}</h3>}
          <span className="hh-spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * One row of a card: label and hint on the left, the control on the right. `labelFor` makes the label a `<label>` for
 * that control; `hintId` lets the control be described by the hint. A row search can open writes its `data-setting`
 * literally at the call site (the registry test reads it there).
 */
export function SettingRow({
  label,
  hint,
  children,
  labelFor,
  hintId,
  className,
  "data-setting": setting,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  labelFor?: string;
  hintId?: string;
  className?: string;
  "data-setting"?: string;
}) {
  return (
    <div className={className ? `hh-setting-row ${className}` : "hh-setting-row"} data-setting={setting}>
      <div className="hh-setting-text">
        {labelFor ? <label htmlFor={labelFor}>{label}</label> : <span>{label}</span>}
        {hint && (
          <span className="hh-caption" id={hintId}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
