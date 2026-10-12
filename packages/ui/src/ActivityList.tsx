import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import loaderGif from "./assets/loader.gif";
import { CheckIcon } from "./chrome";
import type { LiveActivity } from "./state";

type Step = Pick<LiveActivity, "kind" | "detail" | "done">;

const REDUCE = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches;
}

/** Follows the system's "reduce motion" setting, live. */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCE);
    const onChange = () => setReduce(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}

/** The grey working ring: animated, or still when the system asks for less motion. Decorative. */
export function Loader({ size }: { size: 13 | 18 }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className="hh-loader-static" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="hh-loader" src={loaderGif} alt="" width={size} height={size} />;
}

/**
 * Whether the live turn's detail is open: the choice holds for the rest of the app session (never saved to disk).
 */
let liveDetailOpen = false;

/** Back to the default (collapsed); for tests. */
export function resetWorkDetail() {
  liveDetailOpen = false;
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

function Steps({ id, items, open, label }: { id: string; items: Step[]; open: boolean; label: string }) {
  const { t } = useTranslation();
  return (
    <ul id={id} className="hh-activity" aria-label={label} hidden={!open}>
      {open &&
        items.map((a, i) => (
          <li key={i} className={a.done ? "done" : "running"}>
            <span className="hh-activity-mark">{a.done ? <CheckIcon /> : <Loader size={13} />}</span>
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
      <Chevron up={open} />
    </button>
  );
}

/**
 * A turn in progress: one row ("Working…" and a ring) and, behind a toggle, what it is doing step by step.
 * Only the row is a live region, so screen readers hear "Working…" once, not every step.
 */
export function WorkingStatus({ items }: { items: Step[] }) {
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
          <Loader size={18} />
          <span>{mounted ? t("chat.working") : ""}</span>
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
