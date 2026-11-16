import { type ReactNode, useId, useState } from "react";
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
 * A turn in progress: behind a toggle, what it is doing step by step. What it does now is said once, by the working
 * line at the bottom of the conversation (task view one column), not here.
 */
export function WorkingStatus({ items }: { items: Step[] }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(liveDetailOpen);
  const toggle = () => {
    liveDetailOpen = !open;
    setOpen(!open);
  };
  return (
    <div className="hh-work">
      <div className="hh-work-row">
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
