import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { CheckIcon } from "./chrome";
import { type AppState, type TaskView, nextInPath } from "./client";

/** The start view's copy: keys of the harness's own strings (its `locales`). */
export interface StartViewCopy {
  title?: string;
  intro?: string;
  /** Questions offered as chips: each starts a free-question task. */
  faq?: string[];
  /** One line under the composer. */
  hint?: string;
}

/** Flow mode with no task on screen: the topics (path order first) and frequent questions. */
export function StartView({
  state,
  lang,
  tasks,
  copy = {},
  notice,
  disabled,
  onStart,
  onAsk,
}: {
  state: AppState;
  lang: Language;
  tasks: TaskView;
  copy?: StartViewCopy;
  /** A notice to show first (the engine changed, the folder went back). */
  notice: string | null;
  disabled: boolean;
  onStart: (action: string) => void;
  onAsk: (question: string) => void;
}) {
  const { t } = useTranslation();
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id))];
  const suggested = nextInPath(path, undefined, tasks.actions);
  const text = (key: string | undefined, fallback: string) => (key ? t(key, { ns: "harness" }) : fallback);
  return (
    <section className="hh-start-view" aria-labelledby="hh-start-title">
      {notice && (
        <p className="hh-start-notice" role="status">
          {notice}
        </p>
      )}
      <div className="hh-start-head">
        <h2 id="hh-start-title">{text(copy.title, t("flow.startTitle"))}</h2>
        <p>{text(copy.intro, t("flow.startIntro"))}</p>
      </div>
      <div className="hh-topics">
        {ids.map((id) => {
          const action = state.actions[id];
          const status = tasks.actions[id];
          const next = id === suggested;
          return (
            <button
              key={id}
              type="button"
              className={`hh-topic${status === "done" ? " done" : ""}${next ? " next" : ""}`}
              disabled={disabled}
              onClick={() => onStart(id)}
            >
              <span className="hh-topic-head">
                <span className="hh-topic-title">{action.label[lang]}</span>
                {status === "done" ? (
                  <span className="hh-badge ok">
                    <CheckIcon />
                    {t("flow.seen")}
                  </span>
                ) : next ? (
                  <span className="hh-badge">{t("flow.nextUp")}</span>
                ) : status ? (
                  <span className="hh-badge">{t(`flow.${status}`)}</span>
                ) : null}
              </span>
              {action.description && <span className="hh-topic-text">{action.description[lang]}</span>}
            </button>
          );
        })}
      </div>
      {copy.faq && copy.faq.length > 0 && (
        <div className="hh-faq">
          <h3 className="hh-flow-heading">{t("flow.faq")}</h3>
          <div className="hh-chips">
            {copy.faq.map((key) => {
              const question = t(key, { ns: "harness" });
              return (
                <button key={key} type="button" className="hh-chip" disabled={disabled} onClick={() => onAsk(question)}>
                  {question}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
