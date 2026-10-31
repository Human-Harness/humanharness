import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, LockIcon, NoteIcon } from "./chrome";
import { type AppState, type TaskView, nextInPath } from "./client";
import { shownLanguage } from "./language";

/**
 * A small ring: the context the task's session uses against its cap, the exact tokens on hover (spec §6). With
 * `onOpen`, a button that opens the context panel (context-panel spec §5.1).
 */
/** `pill`: the task header's "Context n%" pill (UI refresh spec §5.1); without it, the ring alone (the flow side). */
export function ContextMeter({ used, cap, onOpen, pill }: { used: number; cap: number; onOpen?: () => void; pill?: boolean }) {
  const { t, i18n } = useTranslation();
  const readoutId = useId();
  if (!(cap > 0)) return null;
  const pct = Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));
  const ring = (
    <span
      className={pct >= 80 ? "hh-context-meter warn" : "hh-context-meter"}
      role="meter"
      aria-label={t("models.context")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
      title={t("models.contextTitle", { used: fmt(used), cap: fmt(cap) })}
    >
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="7" pathLength={100} />
        <circle cx="9" cy="9" r="7" pathLength={100} strokeDasharray={`${pct} 100`} />
      </svg>
    </span>
  );
  if (!onOpen) return ring;
  // A button's content is presentational: the meter's readout reaches screen readers as the button's description.
  return (
    <button type="button" className={pill ? "hh-ctxp-meter hh-pill" : "hh-ctxp-meter"} aria-label={t("context.open")} aria-describedby={readoutId} onClick={onOpen}>
      {ring}
      {pill && t("context.pill", { pct })}
      <span id={readoutId} className="hh-sr-only">
        {t("models.contextReadout", { pct, used: fmt(used), cap: fmt(cap) })}
      </span>
    </button>
  );
}

/** Flow mode's left panel: the guided path, the notes so far and the read-only reference folders. */
export function FlowSide({
  state,
  tasks,
  disabled,
  onStart,
  onOpenNote,
  material,
  plugins,
  onContext,
}: {
  state: AppState;
  tasks: TaskView;
  disabled: boolean;
  onStart: (action: string) => void;
  onOpenNote: (slug: string) => void;
  /** The scope's material panel, after the notes (only with `state.material`). */
  material?: ReactNode;
  /** The Plugins section, after the material (only with running plugins that have panels there). */
  plugins?: ReactNode;
  /** Opens the context panel from the meter. */
  onContext?: () => void;
}) {
  const { t } = useTranslation();
  const pathId = useId();
  const notesId = useId();
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  // The step on screen: the running task's, or (idle) the one the path suggests next.
  const current = tasks.current ? tasks.current.action : (nextInPath(path, undefined, tasks.actions) ?? undefined);
  return (
    <nav className="hh-flow-side" aria-label={t("flow.path")}>
      {tasks.current && !tasks.current.action && tasks.current.context && (
        <p className="hh-flow-question">
          {t("models.questions")}
          <ContextMeter {...tasks.current.context} onOpen={onContext} />
        </p>
      )}
      {path.length > 0 && (
        <section>
          <h2 id={pathId} className="hh-flow-heading">
            {t("flow.path")}
          </h2>
          <ol className="hh-steps" aria-labelledby={pathId}>
            {path.map((id, i) => {
              const here = id === current;
              const done = tasks.actions[id] === "done" && !here;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={here ? "step" : undefined}
                    disabled={disabled || (here && tasks.current !== null)}
                    onClick={() => onStart(id)}
                  >
                    <span className={done ? "hh-step-mark done" : "hh-step-mark"} aria-hidden="true">
                      {done ? <CheckIcon /> : i + 1}
                    </span>
                    {state.actions[id].label}
                    {done && <span className="hh-sr-only"> {t("flow.seen")}</span>}
                  </button>
                  {here && tasks.current?.action === id && tasks.current.context && <ContextMeter {...tasks.current.context} onOpen={onContext} />}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {tasks.notes.length > 0 && (
        <section>
          <h2 id={notesId} className="hh-flow-heading">
            {t("flow.covered")}
          </h2>
          <ul className="hh-rows hh-note-list" aria-labelledby={notesId}>
            {tasks.notes.map((n) => (
              <li key={n.slug}>
                <button type="button" onClick={() => onOpenNote(n.slug)}>
                  <NoteIcon />
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {material}
      {plugins}
      {(state.references ?? []).length > 0 && (
        <div className="hh-flow-refs">
          {(state.references ?? []).map((r) => (
            <p key={r.id} className="hh-flow-ref">
              <code title={r.label}>{r.path}</code>
              <span>
                <LockIcon />
                {t("flow.readOnly")}
              </span>
            </p>
          ))}
        </div>
      )}
    </nav>
  );
}
