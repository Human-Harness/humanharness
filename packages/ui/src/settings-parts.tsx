import type { ReactNode } from "react";

/** A Settings section's head (UI refresh spec §5.5): title, what it is for and when a change applies, and an optional control. */
export function SectionHead({ title, line, aside }: { title: string; line: string; aside?: ReactNode }) {
  return (
    <header className="hh-section-head">
      <div>
        <h2>{title}</h2>
        <p className="hh-caption">{line}</p>
      </div>
      {aside}
    </header>
  );
}

/** A card of rows inside a section, with an optional title and actions on its head. */
export function SettingsCard({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="hh-card hh-settings-card">
      {(title || actions) && (
        <div className="hh-settings-card-head">
          {title && <h3>{title}</h3>}
          <span className="hh-spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** One row of a card: label and hint on the left, the control on the right. */
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="hh-setting-row">
      <div className="hh-setting-text">
        <span>{label}</span>
        {hint && <span className="hh-caption">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
