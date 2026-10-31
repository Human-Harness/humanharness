import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Language, canonicalLanguage, offeredLanguage } from "@humanharness/harness-sdk/language";
import { BackupNotice, type FolderMove } from "./BackupNotice";
import { CheckIcon, EngineIcon, GearIcon, HHLogo, TopBar } from "./chrome";
import {
  type AppConfig,
  type AppState,
  type EngineStatus,
  type HarnessClient,
  type HistoryTaskView,
  type LanguageState,
  type LimitWindow,
  type SetupStepsState,
  engineProblem,
  isConfigured,
  timeAgo,
} from "./client";
import { LanguageChooser } from "./LanguageChooser";
import type { LanguageControl } from "./language-control";
import { ownName, shownLanguage, systemLanguage } from "./language";
import { PickUp, pickUpItems } from "./PickUp";
import { useTasks } from "./parallel/useTasks";
import type { SearchIntent } from "./search/intent";
import { WARN_AT, fiveHour, percent } from "./usage";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useCurrentWindows } from "./UsageMeter";

/** English and its variants (en-GB) show the bundled English: nothing to offer (D0). */
const isEnglish = (tag: string): boolean => tag === "en" || tag.startsWith("en-");

/** Stands for the language's name in a translated sentence, so the name can be wrapped in its own element. */
const NAME_MARK = "\u0000";

/** A tag worth offering: canonical, left to right, not English; else null. */
function suggestion(tag: string | undefined): Language | null {
  const canonical = tag ? canonicalLanguage(tag) : null;
  return canonical && !isEnglish(canonical) && offeredLanguage(canonical) ? canonical : null;
}

/**
 * The language Home would offer before the state is known, or null: only then does Home ask for it (asking runs an
 * engine check). Only on a ready Home (set up, engine connected, Start offered), outside mock mode, not yet answered;
 * the saved language if it isn't English, else the system language if it isn't. An English person on an English system gets null (D0).
 */
function offerCandidate(state: { config: AppConfig; mock?: boolean }, ready: boolean | null, system: Language): Language | null {
  if (ready !== true || state.mock || state.config.languageOffered === true || !isConfigured(state.config)) return null;
  const saved = canonicalLanguage(state.config.language);
  if (saved && !isEnglish(saved)) return suggestion(saved);
  return suggestion(system);
}

/**
 * The language to offer on Home once (spec §3, §10), or null. Only on a ready Home, outside mock mode, never once
 * answered, and only with a non-English suggestion (D0: an English person and an English system see nothing new):
 * the saved language when it has no translation at all (a started one is Settings' "finish translating"), else the
 * system language. Never during a run.
 */
export function languageOffer(state: { config: AppConfig; mock?: boolean }, view: LanguageState | null, ready: boolean | null, system: Language): Language | null {
  if (!view || view.run?.status === "running" || offerCandidate(state, ready, system) === null) return null;
  const saved = canonicalLanguage(view.language);
  if (saved && !isEnglish(saved)) {
    const started = view.cached.some((c) => canonicalLanguage(c.tag) === saved);
    return view.missing > 0 && !started ? suggestion(saved) : null;
  }
  return suggestion(system);
}

/** The first screen of every launch (spec 2026-10-11 "Home"). */
export function Home({
  state,
  client,
  onChange,
  status,
  checkFailed = false,
  limits,
  steps,
  onStart,
  onSetup,
  onSettings,
  onEngine,
  move,
  onAddProfile,
  language,
  onOpen,
}: {
  state: AppState;
  client: HarnessClient;
  /** The app state changed (the folder moved, the backup notice was dismissed). */
  onChange: (state: AppState) => void;
  /** Background check of the configured engine; null while it runs. */
  status: EngineStatus | null;
  /** The background check itself failed: shown as not connected. */
  checkFailed?: boolean;
  limits: LimitWindow[] | null;
  /** The harness's setup steps' state (setup-steps spec §4); null while it loads. Unused without setup steps. */
  steps?: SetupStepsState | null;
  /** The app is ready: the work screen. */
  onStart: () => void;
  /** Something is missing: the setup flow, at this harness step when it is one. */
  onSetup: (step?: string) => void;
  onSettings: () => void;
  onEngine: () => void;
  /** The app's folder move (HarnessApp): a move started in Settings still shows here. */
  move?: FolderMove;
  /** Harnesses with profiles: "Add <label>" (the setup screen at its profile step). */
  onAddProfile?: () => void;
  /** Language on demand (plan 5b): the offer card. Absent without `client.language` (D0: no card). */
  language?: LanguageControl;
  /** "Pick up where you left": a task's card was clicked (an open task, or History at that task). Absent: the work screen. */
  onOpen?: (intent: SearchIntent) => void;
}) {
  const { t, i18n } = useTranslation();
  const missingId = useId();
  const name = state.harness.name;
  const engine = state.engines.find((e) => e.id === state.config.engineId);
  const connected = checkFailed ? false : status ? engineProblem(status) === null : null;
  const current = useCurrentWindows(limits);
  const window = engine?.reportsLimits ? fiveHour(current) : undefined;
  // Spec 3f §1: start only when set up and the engine check passed; otherwise say what is missing.
  const configured = isConfigured(state.config);
  // Setup steps (setup-steps spec §4): a required one not done keeps Home on "Set up"; while their state loads, Start waits.
  const stepsKnown = state.setup === undefined || steps != null;
  const blocking = configured && state.setup ? (steps?.blocking ?? []) : [];
  // Profiles (spec §5): with no active profile, nothing under the folder can be used yet. It doesn't wait for the
  // switcher: "Set up" opens the profile step on its own.
  const needsProfile = configured && state.profiles !== undefined && !state.config.profile;
  const ready = configured && !needsProfile && connected === true && stepsKnown && blocking.length === 0;
  const checking = configured && !needsProfile && (connected === null || (connected === true && !stepsKnown));
  const stepLabel = (id: string) => state.setup?.find((s) => s.id === id)?.label ?? id;
  const engineName = engine?.name ?? state.config.engineId ?? "";
  const missingStep = checkFailed ? "check-failed" : status ? engineProblem(status) : null;

  // Pick up where you left (UI refresh spec §5.2): the open tasks of a harness with `parallel`, else History's latest tasks.
  const parallel = Boolean(state.parallel);
  const openTasks = useTasks(client, parallel && ready);
  const [past, setPast] = useState<HistoryTaskView[] | null>(null);
  useEffect(() => {
    if (!ready || parallel) return;
    let live = true;
    client.historyTasks().then(
      (groups) => live && setPast(groups),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, ready, parallel]);
  const lang = shownLanguage(i18n);
  const pickUp = ready ? pickUpHome() : [];
  function pickUpHome() {
    const taskState = { running: "working", closing: "working", waiting: "waiting", checkpoint: "waiting", queued: "queued" } as const;
    const open = (openTasks?.tasks ?? []).map((x) => ({ id: x.id, title: x.label, state: taskState[x.state], updatedAt: Date.parse(x.startedAt) || 0 }));
    const history = (past ?? []).flatMap((g) =>
      g.taskId === null
        ? []
        : [
            {
              id: g.taskId,
              title: g.noteTitle ?? (g.actionId && Object.hasOwn(state.actions, g.actionId) ? state.actions[g.actionId].label : g.actionId === null ? t("history.question") : t("history.task")),
              outcome: g.noteTitle ? ("noteSaved" as const) : ("inProgress" as const),
              endedAt: Date.parse(g.date) || 0,
            },
          ],
    );
    const items = pickUpItems({ open, history });
    return items.map((i) => {
      const task = openTasks?.tasks.find((x) => x.id === i.id);
      if (task) {
        const ago = timeAgo(task.startedAt, lang);
        return { ...i, status: t(`home.status.${i.status}`), where: [task.phase, ago].filter(Boolean).join(" · ") };
      }
      const group = past?.find((g) => g.taskId === i.id);
      const ago = group ? timeAgo(group.date, lang) : "";
      return { ...i, status: t(`home.status.${i.status}`), where: i.status === "noteSaved" ? t("home.noteSavedAgo", { ago }) : ago };
    });
  }
  const openPickUp = (id: string) => {
    const isOpen = openTasks?.tasks.some((x) => x.id === id) === true;
    if (onOpen) onOpen(isOpen ? { kind: "open-task", task: id } : { kind: "history", task: id });
    else {
      if (isOpen) void client.tasks.focus(id).catch(() => undefined);
      onStart();
    }
  };

  // The language offer (spec §3, §10): asked for only when there is a non-English suggestion (an engine check runs).
  const offerId = useId();
  const startRef = useRef<HTMLButtonElement>(null);
  const [choosing, setChoosing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const system = systemLanguage();
  const wantsOffer = language !== undefined && !dismissed && offerCandidate(state, ready, system) !== null;
  const offer = language && !dismissed ? languageOffer(state, language.view, ready, system) : null;
  // The chooser keeps the suggestion after the card goes (the answer is saved as soon as the card is acted on).
  const offered = useRef<Language | null>(null);
  if (offer) offered.current = offer;
  // `language` is a new object on every render; `load` is stable.
  const load = language?.load;
  useEffect(() => {
    if (wantsOffer) load?.();
  }, [wantsOffer, load]);
  // The card's buttons are gone once it is answered (and the chooser's opener with them): focus lands on Start, not on
  // nothing. Runs after the closed chooser's own focus return, so a focus it put back is kept.
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body) startRef.current?.focus();
  }, [refocus]);
  const answerOffer = () => {
    setDismissed(true);
    void client.saveConfig({ languageOffered: true }).then(onChange, () => undefined);
  };

  return (
    <div className="hh-home">
      <TopBar mock={state.mock}>
        {configured && state.profiles && onAddProfile && <ProfileSwitcher client={client} state={state} onSwitched={onChange} onAdd={onAddProfile} disabled={move?.moving === true} />}
        <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
          <GearIcon />
        </button>
      </TopBar>
      <main className="hh-home-main">
        {state.harness.logo ? <img className="hh-home-logo" src={state.harness.logo} alt="" /> : <HHLogo className="hh-home-logo" />}
        <h1 className="hh-home-name">{name}</h1>
        {state.harness.tagline && <p className="hh-home-tagline">{state.harness.tagline}</p>}
        {!configured && (
          <section className="hh-missing" aria-labelledby={missingId}>
            <h2 id={missingId}>{t("home.missing.title")}</h2>
            <ol>
              <li>
                <span className={state.config.folder ? "hh-step-mark done" : "hh-step-mark"}>{state.config.folder ? <CheckIcon /> : 1}</span>
                {t("home.missing.folder")}
              </li>
              <li>
                <span className="hh-step-mark">2</span>
                {t("home.missing.engine")}
              </li>
            </ol>
          </section>
        )}
        {configured && missingStep && (
          <section className="hh-missing">
            <p>{t("home.missing.one", { step: t(`home.missing.step.${missingStep}`, { engine: engineName }) })}</p>
          </section>
        )}
        {configured && !missingStep && needsProfile && state.profiles && (
          <section className="hh-missing">
            <p>{t("home.missing.one", { step: t("home.missing.addProfile", { label: state.profiles.label }) })}</p>
          </section>
        )}
        {configured && !missingStep && !needsProfile && blocking.length > 0 && (
          <section className="hh-missing">
            <p>{t("home.missing.one", { step: stepLabel(blocking[0]) })}</p>
          </section>
        )}
        {offer && (
          <section className="hh-langoffer" aria-labelledby={offerId}>
            <h2 id={offerId}>{t("language.offerTitle", { name })}</h2>
            <p className="hh-caption">
              {/* The language's own name is marked with its tag so a screen reader says it in that language. */}
              {t("language.offerSuggested", { language: NAME_MARK })
                .split(NAME_MARK)
                .flatMap((part, i) => (i === 0 ? [part] : [<span key={i} lang={offer}>{ownName(offer)}</span>, part]))}
            </p>
            <div className="hh-langoffer-actions">
              <button
                type="button"
                onClick={() => {
                  answerOffer();
                  setRefocus((n) => n + 1);
                }}
              >
                {t("language.offerLater")}
              </button>
              <button
                type="button"
                className="hh-primary"
                onClick={() => {
                  setChoosing(true);
                  answerOffer();
                }}
              >
                {t("language.offerChoose")}
              </button>
            </div>
          </section>
        )}
        {ready || checking ? (
          <button ref={startRef} className="hh-primary hh-start" disabled={checking} onClick={onStart}>
            {t("home.start", { name })}
          </button>
        ) : (
          <button
            className="hh-primary hh-start"
            onClick={() => (!missingStep && needsProfile && onAddProfile ? onAddProfile() : onSetup(!missingStep && blocking.length > 0 ? blocking[0] : undefined))}
          >
            {t("setupFlow.configure", { name })}
          </button>
        )}
        {engine ? (
          <button className="hh-pill" onClick={onEngine}>
            {engine.logo ? <img src={engine.logo} alt="" /> : <EngineIcon size={18} />}
            <span>{engine.name}</span>
            <span className={connected ? "hh-dot ok" : "hh-dot"} aria-hidden="true" />
            <span>{connected === null ? t("home.checking") : connected ? t("home.connected") : t("home.notConnected")}</span>
            {window && (
              <span className={window.utilization >= WARN_AT ? "hh-warn" : "hh-caption"}>
                {t("home.usage", { label: t("usage.five_hour"), percent: percent(window.utilization) })}
              </span>
            )}
          </button>
        ) : (
          <p className="hh-caption">{t("home.noEngine")}</p>
        )}
        {ready && <PickUp items={pickUp} onOpen={openPickUp} />}
        <BackupNotice client={client} state={state} onChange={onChange} move={move} />
      </main>
      {language && choosing && (
        <LanguageChooser
          control={language}
          start={offered.current ? { pick: offered.current } : {}}
          harnessName={name}
          onClose={() => {
            setChoosing(false);
            setRefocus((n) => n + 1);
          }}
        />
      )}
      <footer className="hh-footer">
        <span className="hh-wordmark">Human Harness</span>
        {state.config.folder && (
          <span className="hh-footer-path" title={state.config.folder}>
            <bdi dir="ltr">{state.config.folder}</bdi>
          </span>
        )}
      </footer>
    </div>
  );
}
