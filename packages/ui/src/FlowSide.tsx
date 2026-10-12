import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { CheckIcon, LockIcon, NoteIcon } from "./chrome";
import { type AppState, type TaskView, nextInPath } from "./client";

/** Flow mode's left panel: the guided path, the notes so far and the read-only reference folders. */
export function FlowSide({
  state,
  lang,
  tasks,
  disabled,
  onStart,
  onOpenNote,
}: {
  state: AppState;
  lang: Language;
  tasks: TaskView;
  disabled: boolean;
  onStart: (action: string) => void;
  onOpenNote: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const pathId = useId();
  const notesId = useId();
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  // The step on screen: the running task's, or (idle) the one the path suggests next.
  const current = tasks.current ? tasks.current.action : (nextInPath(path, undefined, tasks.actions) ?? undefined);
  return (
    <nav className="hh-flow-side" aria-label={t("flow.path")}>
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
                    {state.actions[id].label[lang]}
                    {done && <span className="hh-sr-only"> {t("flow.seen")}</span>}
                  </button>
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
      {(state.references ?? []).length > 0 && (
        <div className="hh-flow-refs">
          {(state.references ?? []).map((r) => (
            <p key={r.id} className="hh-flow-ref">
              <code title={r.label[lang]}>{r.path}</code>
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
