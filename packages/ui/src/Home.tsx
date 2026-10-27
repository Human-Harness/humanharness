import { useId } from "react";
import { useTranslation } from "react-i18next";
import { BackupNotice, type FolderMove } from "./BackupNotice";
import { CheckIcon, EngineIcon, GearIcon, HHLogo, TopBar } from "./chrome";
import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, type SetupStepsState, engineProblem, isConfigured } from "./client";
import { WARN_AT, fiveHour, percent } from "./usage";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useCurrentWindows } from "./UsageMeter";

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
}) {
  const { t } = useTranslation();
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

  return (
    <div className="hh-home">
      <TopBar mock={state.mock}>
        {configured && state.profiles && onAddProfile && <ProfileSwitcher client={client} state={state} onSwitched={onChange} onAdd={onAddProfile} />}
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
        {ready || checking ? (
          <button className="hh-primary hh-start" disabled={checking} onClick={onStart}>
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
