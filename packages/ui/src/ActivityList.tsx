import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./guide/icons";
import type { LiveActivity } from "./state";

type Step = Pick<LiveActivity, "kind" | "detail" | "done">;

/**
 * Whether the live turn's detail is open: the choice holds for the rest of the app session (never saved to disk).
 */
let liveDetailOpen = false;

/** Back to the default (collapsed); for tests. */
export function resetWorkDetail() {
  liveDetailOpen = false;
}

function Steps({ id, items, open, label }: { id: string; items: Step[]; open: boolean; label: string }) {
  const { t } = useTranslation();
  return (
    <ul id={id} className="hh-activity" aria-label={label} hidden={!open}>
      {open &&
        items.map((a, i) => (
          <li key={i} className={a.done ? "done" : "running"}>
            <span className="hh-activity-mark">{a.done ? <Icon name="check" size={14} /> : <Icon name="loading" size={14} />}</span>
            {t(`activity.${a.kind}`, { detail: a.detail })}
          </li>
        ))}
    </ul>
  );
}

function Toggle({ controls, open, onToggle, children }: { controls: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" className="hh-work-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {children}
      <Icon name="chevron" size={14} />
    </button>
  );
}

/**
 * A turn in progress: one row ("Working…", or `label`, and a ring) and, behind a toggle, what it is doing step by step.
 * Only the row is a live region, so screen readers hear "Working…" once, not every step.
 */
export function WorkingStatus({ items, label }: { items: Step[]; label?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(liveDetailOpen);
  // Filled after mounting, so the status region already exists when its text arrives and gets announced.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const toggle = () => {
    liveDetailOpen = !open;
    setOpen(!open);
  };
  return (
    <div className="hh-work">
      <div className="hh-work-row">
        <span className="hh-work-status" role="status">
          <Icon name="loading" size={14} />
          <span>{mounted ? (label ?? t("chat.working")) : ""}</span>
        </span>
        <Toggle controls={id} open={open} onToggle={toggle}>
          {open ? t("chat.hideDetail") : t("chat.showDetail")}
        </Toggle>
      </div>
      <Steps id={id} items={items} open={open} label={t("chat.doing")} />
    </div>
  );
}

/** What a finished turn did, behind a collapsed toggle ("See what it did (3 steps)"). */
export function FinishedActivity({ items }: { items: Step[] }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="hh-work done">
      <Toggle controls={id} open={open} onToggle={() => setOpen(!open)}>
        {open ? t("chat.hideDetail") : t("chat.whatItDid", { count: items.length })}
      </Toggle>
      <Steps id={id} items={items} open={open} label={t("chat.did")} />
    </div>
  );
}
