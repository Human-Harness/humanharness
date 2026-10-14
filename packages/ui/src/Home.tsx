import { useId } from "react";
import { useTranslation } from "react-i18next";
import { BackupNotice, type FolderMove } from "./BackupNotice";
import { CheckIcon, EngineIcon, GearIcon, HHLogo, TopBar } from "./chrome";
import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, engineProblem, isConfigured } from "./client";
import { uiLanguage } from "./FolderStep";
import { WARN_AT, fiveHour, percent } from "./usage";
import { useCurrentWindows } from "./UsageMeter";

/** The first screen of every launch (spec 2026-10-11 "Home"). */
export function Home({
  state,
  client,
  onChange,
  status,
  checkFailed = false,
  limits,
  onStart,
  onSetup,
  onSettings,
  onEngine,
  move,
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
  /** The app is ready: the work screen. */
  onStart: () => void;
  /** Something is missing: the setup flow. */
  onSetup: () => void;
  onSettings: () => void;
  onEngine: () => void;
  /** The app's folder move (HarnessApp): a move started in Settings still shows here. */
  move?: FolderMove;
}) {
  const { t, i18n } = useTranslation();
  const missingId = useId();
  const lang = uiLanguage(state, i18n.language);
  const name = state.harness.name[lang];
  const engine = state.engines.find((e) => e.id === state.config.engineId);
  const connected = checkFailed ? false : status ? engineProblem(status) === null : null;
  const current = useCurrentWindows(limits);
  const window = engine?.reportsLimits ? fiveHour(current) : undefined;
  // Spec 3f §1: start only when set up and the engine check passed; otherwise say what is missing.
  const configured = isConfigured(state.config);
  const ready = configured && connected === true;
  const checking = configured && connected === null;
  const engineName = engine?.name ?? state.config.engineId ?? "";
  const missingStep = checkFailed ? "check-failed" : status ? engineProblem(status) : null;

  return (
    <div className="hh-home">
      <TopBar mock={state.mock}>
        <button className="hh-icon-button" aria-label={t("home.settings")} onClick={onSettings}>
          <GearIcon />
        </button>
      </TopBar>
      <main className="hh-home-main">
        {state.harness.logo ? <img className="hh-home-logo" src={state.harness.logo} alt="" /> : <HHLogo className="hh-home-logo" />}
        <h1 className="hh-home-name">{name}</h1>
        {state.harness.tagline && <p className="hh-home-tagline">{state.harness.tagline[lang]}</p>}
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
        {ready || checking ? (
          <button className="hh-primary hh-start" disabled={checking} onClick={onStart}>
            {t("home.start", { name })}
          </button>
        ) : (
          <button className="hh-primary hh-start" onClick={onSetup}>
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
        <BackupNotice client={client} state={state} onChange={onChange} move={move} />
      </main>
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
