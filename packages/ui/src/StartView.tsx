import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, Segmented, Tag } from "./chrome";
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

/** Where the Cards / List choice is kept (UI refresh spec §5.3). Either call may throw: the view then falls back to Cards. */
export interface StartViewStorage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

type Layout = "cards" | "list";

/** The renderer's localStorage; absent (tests, a locked-down window) it keeps nothing. */
const localStore: StartViewStorage = {
  get: (key) => window.localStorage.getItem(key),
  set: (key, value) => window.localStorage.setItem(key, value),
};

function readLayout(storage: StartViewStorage, key: string): Layout {
  try {
    return storage.get(key) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

/** Flow mode with no task on screen: the topics (path order first) and frequent questions. */
export function StartView({
  state,
  tasks,
  copy = {},
  notice,
  disabled,
  onStart,
  onAsk,
  storage = localStore,
}: {
  state: AppState;
  tasks: TaskView;
  copy?: StartViewCopy;
  /** A notice to show first (the engine changed, the folder went back). */
  notice: string | null;
  disabled: boolean;
  onStart: (action: string) => void;
  onAsk: (question: string) => void;
  /** Keeps the Cards / List choice per harness; the renderer's localStorage by default. */
  storage?: StartViewStorage;
}) {
  const { t } = useTranslation();
  const layoutKey = `hh.start.view.${state.harness.id}`;
  const [layout, setLayout] = useState<Layout>(() => readLayout(storage, layoutKey));
  const pickLayout = (next: Layout) => {
    setLayout(next);
    try {
      storage.set(layoutKey, next);
    } catch {
      // Not kept: the choice still holds until the view closes.
    }
  };
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  // An interview step's action is no topic (setup-steps spec §3).
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id) && !state.actions[id].setup)];
  const suggested = nextInPath(path, undefined, tasks.actions);
  const doneCount = ids.filter((id) => tasks.actions[id] === "done").length;
  const text = (key: string | undefined, fallback: string) => (key ? t(key, { ns: "harness" }) : fallback);
  return (
    <div className="hh-start-view">
      {notice && (
        <p className="hh-start-notice" role="status">
          {notice}
        </p>
      )}
      <div className="hh-start-head">
        <h2 id="hh-start-title" className="hh-start-title">
          {text(copy.title, t("flow.startTitle"))}
        </h2>
        <p>{text(copy.intro, t("flow.startIntro"))}</p>
      </div>
      {/* The switch stays out of the region: the region's buttons are the topics and the questions. */}
      <div className="hh-start-path-head">
        <h3 className="hh-flow-heading">{t("start.view.path")}</h3>
        <span className="hh-caption">{t("start.view.done", { done: doneCount, total: ids.length })}</span>
        <Segmented
          label={t("start.view.label")}
          options={[
            { value: "cards", label: t("start.view.cards") },
            { value: "list", label: t("start.view.list") },
          ]}
          value={layout}
          onChange={pickLayout}
        />
      </div>
      <section className="hh-start-body" aria-labelledby="hh-start-title">
        {/* "Topics", not "Guided path": the flow side's list already has that name, and topics off the path show here too. */}
        <ol aria-label={t("start.view.topics")} className={layout === "list" ? "hh-topics hh-topics-list" : "hh-topics"}>
          {ids.map((id, i) => {
            const action = state.actions[id];
            const status = tasks.actions[id];
            const next = id === suggested;
            const tier = action.tier;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`hh-topic${status === "done" ? " done" : ""}${next ? " next hh-topic-next" : ""}`}
                  disabled={disabled}
                  onClick={() => onStart(id)}
                >
                  <span className="hh-topic-head">
                    <span className="hh-topic-num" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="hh-topic-title">{action.label}</span>{" "}
                    {/* Only the tags that say what the topic already said are read: the rest is for the eye. */}
                    <span className="hh-topic-tags">
                      {status === "done" ? (
                        <Tag tone="green">
                          <CheckIcon />
                          {t("start.view.doneTag")}
                        </Tag>
                      ) : next ? (
                        <>
                          <span className="hh-tag hh-tag-orange" aria-hidden="true">
                            {t("start.view.upNext")}
                          </span>
                          <span className="hh-sr-only">{t("flow.nextUp")}</span>
                        </>
                      ) : status ? (
                        <Tag tone="gray">{t(`flow.${status}`)}</Tag>
                      ) : (
                        <span className="hh-tag hh-tag-gray" aria-hidden="true">
                          {t("start.view.toDo")}
                        </span>
                      )}
                      {tier && (
                        <span className={`hh-tag hh-tag-${tier === "deep" ? "violet" : tier === "light" ? "green" : "blue"}`} aria-hidden="true">
                          {t(`models.tier.${tier}`)}
                        </span>
                      )}
                    </span>
                  </span>
                  {action.description && <span className="hh-topic-text">{action.description}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {copy.faq && copy.faq.length > 0 && (
          <div className="hh-faq">
            <h3 className="hh-flow-heading">{t("start.view.askNow")}</h3>
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
    </div>
  );
}
