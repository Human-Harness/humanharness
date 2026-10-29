import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PARALLEL_MAX } from "@humanharness/harness-sdk";
import { BackupNotice, type FolderMove, MovePlaces, needsBackupNotice, useFolderMove } from "./BackupNotice";
import { EngineIcon, Segmented } from "./chrome";
import { type AppConfig, type AppState, type Appearance, type HarnessClient, type RunningSetup, TEXT_SIZES, type TextSize, isConfigured } from "./client";
import { ConnectionsTab } from "./connections/ConnectionsTab";
import { EngineTab } from "./EngineTab";
import { trapTab } from "./focus";
import { HarnessSettingsTab } from "./HarnessSettingsTab";
import { type Language, languageName } from "@humanharness/harness-sdk/language";
import { ownName, systemLanguage } from "./language";
import type { LanguageControl } from "./language-control";
import { LanguageChooser } from "./LanguageChooser";
import { useLatestConfig } from "./latest-config";
import { ModelsTab } from "./ModelsTab";
import { JobsTab } from "./parallel/JobsTab";
import { PluginsTab } from "./plugins/PluginsTab";
import { ProfilesSection } from "./ProfilesSection";
import { SetupStepsList } from "./SetupStepsList";
import { SidekickTab } from "./sidekick/SidekickTab";
import { useSidekick } from "./sidekick/useSidekick";
import { UsageTab } from "./UsageTab";

export type SettingsTab = "general" | "harness" | "engine" | "models" | "sidekick" | "plugins" | "connections" | "jobs" | "usage";
/**
 * `harness` is the harness's own tab (manifest `settings`), right after General (harness-settings spec §4); Sidekick
 * after Models (sidekick spec §8); Plugins after Sidekick (plugins spec §7); Connections after Plugins (tools spec §9);
 * Jobs before Usage (parallel spec §9).
 */
const TABS: SettingsTab[] = ["general", "harness", "engine", "models", "sidekick", "plugins", "connections", "jobs", "usage"];
const TEXT_SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];
/** The key that zooms with + and −: ⌘ on macOS, Ctrl elsewhere. */
const ZOOM_KEY = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** The Settings sheet (spec 2026-10-11 "Settings sheet"): attached under the top bar, dimmed backdrop. */
export function SettingsSheet({
  client,
  state,
  tab,
  onTab,
  onChange,
  onClose,
  onSetup,
  move: shared,
  onStartAction,
  language,
}: {
  client: HarnessClient;
  state: AppState;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onChange: (state: AppState) => void;
  onClose: () => void;
  /**
   * Opens the setup flow (the empty state of the harness's tab, Engine, Models and Usage before the app is configured);
   * at a harness step when one is given (the Setup list's Do it again / Do it now).
   */
  onSetup: (step?: string) => void;
  /** The app's folder move (HarnessApp), so a move outlives the sheet; without it the sheet keeps its own. */
  move?: FolderMove;
  /** Settings › Jobs' Start on a needs-you run: the action starts in the chat on screen; false when it couldn't. */
  onStartAction?: (action: string, scope: string | null) => boolean;
  /** Language on demand (plan 5b); absent (no `client.language`): the read-only Language row (D0). */
  language?: LanguageControl;
}) {
  const { t } = useTranslation();
  const own = useFolderMove(client, onChange);
  const move = shared ?? own;
  const runningId = useId();
  const baseId = useId();
  const tabId = (id: SettingsTab) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  // Models only shows when the main process sent its view (every packaged app does); the harness's tab only when it
  // declares settings or setup steps (harness-settings D0, setup-steps D0); Sidekick only when main sends it (sidekick D0);
  // Plugins only when the harness takes them (plugins D0); Connections only when it declares secrets (tools D0); Jobs
  // only when it declares jobs (parallel D0).
  const tabs = TABS.filter(
    (id) =>
      (id !== "models" || state.models !== undefined) &&
      (id !== "harness" || state.settings !== undefined || state.setup !== undefined) &&
      (id !== "sidekick" || state.sidekick !== undefined) &&
      (id !== "plugins" || state.plugins !== undefined) &&
      (id !== "connections" || state.connections !== undefined) &&
      (id !== "jobs" || state.jobs !== undefined),
  );
  const configured = isConfigured(state.config);
  // The tab reads "Sidekicks" once there are two or more (spec §8); its id stays "sidekick".
  const sidekick = useSidekick(client, state.sidekick !== undefined);
  const sidekickTab = (sidekick?.sidekicks?.length ?? 1) > 1 ? t("sidekick.list.title") : t("sidekick.tab");
  const doneRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** An install, update, sign-in or sign-out is running: the sheet stays open (it shows how it goes). */
  const [running, setRunning] = useState<RunningSetup | null>(null);
  const runningRef = useRef(false);
  runningRef.current = running !== null;
  const close = () => {
    if (!runningRef.current) onCloseRef.current();
  };

  useEffect(() => {
    let heard = false;
    const off = client.onSetupOutput((o) => {
      if (o.kind === "start" || o.kind === "end") {
        heard = true;
        setRunning(o.kind === "start" ? { engineId: o.engineId, step: o.step } : null);
      }
    });
    // A step may already be running (started before this sheet opened, e.g. before a reload).
    client.getSetup().then(
      (r) => {
        if (!heard && r) setRunning({ engineId: r.engineId, step: r.step });
      },
      () => {},
    );
    return off;
  }, [client]);

  // A disabled Done can't hold focus: while a step runs, focus goes to the selected tab instead.
  const isRunning = running !== null;
  useEffect(() => {
    const active = document.activeElement;
    if (isRunning && (active === doneRef.current || active === document.body || active === null)) {
      document.getElementById(tabId(tab))?.focus();
    }
    // Only when a step starts (or is found running); the tab is read as it is then.
  }, [isRunning]);

  /** Arrow keys (and Home/End) move between tabs, as in any tab list. */
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, id: SettingsTab) => {
    const i = tabs.indexOf(id);
    const next =
      e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    onTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  useEffect(() => {
    // Whatever opened the sheet (the gear, the engine pill) gets focus back when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (e.key === "Escape" && !runningRef.current) {
        // Handled: focus mode's window listener leaves this Escape alone.
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === "Tab") trapTab(sheet, e);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div
      className="hh-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={sheetRef} className="hh-sheet" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className="hh-sheet-head">
          <div className="hh-segmented" role="tablist" aria-label={t("settings.title")}>
            {tabs.map((id) => (
              <button
                key={id}
                id={tabId(id)}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={panelId}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => onTab(id)}
                onKeyDown={(e) => onTabKey(e, id)}
              >
                {id === "harness" ? (state.settings?.tab ?? t("settings.tabs.setup")) : id === "sidekick" ? sidekickTab : id === "plugins" ? t("plugins.tab") : id === "connections" ? t("connections.tab") : id === "jobs" ? t("parallel.jobsTab") : t(`settings.tabs.${id}`)}
              </button>
            ))}
          </div>
          <button
            ref={doneRef}
            className="hh-primary"
            disabled={running !== null}
            aria-describedby={running ? runningId : undefined}
            onClick={close}
          >
            {t("settings.done")}
          </button>
        </div>
        {running && (
          <div className="hh-sheet-running">
            <p id={runningId} role="status">
              {t(`settings.running.${running.step}`, { engine: state.engines.find((e) => e.id === running.engineId)?.name ?? running.engineId })}{" "}
              {t("settings.runningWait")}
            </p>
            <button onClick={() => void client.cancelSetup().catch(() => {})}>{t("settings.runningCancel")}</button>
          </div>
        )}
        <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
          {tab === "general" && <GeneralTab client={client} state={state} onChange={onChange} move={move} language={language} />}
          {tab !== "general" && !configured && <NotConfigured state={state} onSetup={onSetup} />}
          {tab === "engine" && configured && <EngineTab client={client} state={state} onChange={onChange} setupEngine={running?.engineId} />}
          {tab === "models" && configured && <ModelsTab client={client} state={state} onChange={onChange} />}
          {tab === "sidekick" && configured && <SidekickTab client={client} onModels={() => onTab("models")} scopes={state.scopes} />}
          {tab === "plugins" && configured && <PluginsTab client={client} />}
          {tab === "connections" && configured && state.connections && <ConnectionsTab client={client} />}
          {tab === "jobs" && configured && state.jobs && <JobsTab client={client} state={state} onChange={onChange} {...(onStartAction ? { onStartAction } : {})} />}
          {tab === "usage" && configured && <UsageTab client={client} state={state} />}
          {tab === "harness" && configured && (
            <>
              {state.setup && (
                <SetupStepsList
                  client={client}
                  steps={state.setup}
                  onRun={(id) => onSetup(id)}
                  onConnections={state.connections ? () => onTab("connections") : undefined}
                />
              )}
              {state.settings && <HarnessSettingsTab client={client} view={state.settings} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** English and its variants (en-GB) show the bundled English: nothing to translate. */
const isEnglish = (tag: string): boolean => tag === "en" || tag.startsWith("en-");

/**
 * Settings › General › Language (spec §3, §5, §6): the language by its own name and its English name, Change…, a run's
 * progress and Cancel, Try again after a stopped run (it resumes, Q6), and Translate when texts are missing (new texts,
 * or a saved language with no translation yet). Without a language control (D0): the read-only row of plan 5a.
 */
function LanguageRow({ state, language }: { state: AppState; language?: LanguageControl }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<null | { pick?: Language } | { notice: Language }>(null);
  const reasonId = useId();
  const view = language?.view ?? null;
  const lang = view?.language ?? state.config.language ?? systemLanguage();
  const run = view?.run ?? null;
  const running = run?.status === "running";
  const can = view?.canTranslate === true;
  const stopped = run && (run.status === "failed" || run.status === "cancelled") ? run : null;
  const untranslated = view !== null && !isEnglish(lang) && !running && view.missing > 0;
  const none = untranslated && !view.cached.some((c) => c.tag === lang);
  // Asking for the state runs an engine check, so only a shown row asks. `language` is new on every render; `load` is stable.
  const load = language?.load;
  useEffect(() => load?.(), [load]);
  // The notice opens only when an engine can translate; a stopped run resumes from it (Q6).
  const notice = (tag: Language) => {
    if (can) setOpen({ notice: tag });
  };
  return (
    <>
      <div className="hh-row hh-row-wrap">
        <span className="hh-row-label">{t("settings.language")}</span>
        <span className="hh-langrow-name">
          <span lang={lang}>{ownName(lang)}</span>
          {!isEnglish(lang) && (
            <span className="hh-caption" lang="en">
              {languageName(lang)}
            </span>
          )}
        </span>
        {language && view && (
          <button type="button" onClick={() => setOpen({})} disabled={running}>
            {t("language.change")}
          </button>
        )}
        <p className="hh-caption hh-row-note">{t("settings.languageHint")}</p>
      </div>
      {language && (running || stopped) && (
        // One row and one live region for a run's progress and its stop, so the change from one to the other is
        // announced. While the chooser is open its own progress dialog speaks: the row has no role then.
        <div className={`hh-row ${running ? "hh-langrow-progress" : "hh-langrow-stopped"}`}>
          <span role={open ? undefined : "status"}>{running ? t("language.progress", { done: run.done, total: run.total }) : stopped?.reason === "quota" ? t("language.stoppedQuota") : t("language.stopped")}</span>
          {running ? (
            <button type="button" onClick={() => language.cancel()}>
              {t("language.cancel")}
            </button>
          ) : (
            stopped && (
              <button type="button" disabled={!can} aria-describedby={!can ? reasonId : undefined} onClick={() => notice(stopped.tag)}>
                {t("language.tryAgain")}
              </button>
            )
          )}
        </div>
      )}
      {language && !stopped && untranslated && (
        <div className="hh-row hh-langrow-new">
          <span>{none ? t("language.notYet", { language: ownName(lang) }) : t("language.newTexts")}</span>
          <button type="button" disabled={!can} aria-describedby={!can ? reasonId : undefined} onClick={() => notice(lang)}>
            {t("language.translate")}
          </button>
        </div>
      )}
      {language && view && !can && (stopped || untranslated) && (
        <p id={reasonId} className="hh-caption hh-langrow-reason">
          {t("language.needsEngine")}
        </p>
      )}
      {language && open && <LanguageChooser control={language} start={open} harnessName={state.harness.name} onClose={() => setOpen(null)} />}
    </>
  );
}

function GeneralTab({
  client,
  state,
  onChange,
  move,
  language,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (s: AppState) => void;
  move: FolderMove;
  language?: LanguageControl;
}) {
  const { t } = useTranslation();
  const placesId = useId();
  const sizeId = useId();
  /** The places to move the folder to are open (the backup notice, when it shows, offers them itself). */
  const [moveOpen, setMoveOpen] = useState(false);
  const offerMove = !needsBackupNotice(state);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // A move that worked closes the list (the folder row shows where it is now); focus stays on its toggle.
  useEffect(() => {
    if (!move.moved) return;
    setMoveOpen(false);
    const active = document.activeElement;
    const lost = active === null || active === document.body || document.getElementById(placesId)?.contains(active) === true;
    if (lost && toggleRef.current?.isConnected) toggleRef.current.focus();
  }, [move.moved]);
  /** Rejects when the save fails (ParallelSection says so); `save` swallows it. */
  const saveOrFail = (patch: AppConfig) => client.saveConfig(patch).then(onChange);
  const save = (patch: AppConfig) => saveOrFail(patch).catch(() => {});
  const appearances: { value: Appearance; label: string }[] = [
    { value: "system", label: t("settings.appearanceSystem") },
    { value: "light", label: t("settings.appearanceLight") },
    { value: "dark", label: t("settings.appearanceDark") },
  ];
  const backup = state.backup?.status;
  const dismissed = backup?.kind === "local" && state.config.backupDismissed === true;
  const backupText = !backup
    ? null
    : backup.kind === "synced"
      ? t("backup.status.synced", { provider: t(`backup.provider.${backup.provider}`) })
      : dismissed
        ? t("backup.status.dismissed")
        : t(`backup.status.${backup.kind}`);

  return (
    <div className="hh-tab">
      <div className="hh-rows">
        <LanguageRow state={state} language={language} />
        <div className="hh-row">
          <span className="hh-row-label">{t("settings.appearance")}</span>
          <Segmented label={t("settings.appearance")} value={state.config.appearance ?? "system"} onChange={(appearance) => void save({ appearance })} options={appearances} />
        </div>
        <div className="hh-row hh-row-wrap">
          <span className="hh-row-label" id={sizeId}>
            {t("settings.textSize")}
          </span>
          <div className="hh-text-sizes" role="group" aria-labelledby={sizeId} aria-describedby={`${sizeId}-hint`}>
            {TEXT_SIZE_KEYS.map((textSize) => (
              <button key={textSize} type="button" aria-pressed={(state.config.textSize ?? "normal") === textSize} onClick={() => void save({ textSize })}>
                <span className="hh-text-size-sample" style={{ fontSize: `${Math.round(15 * TEXT_SIZES[textSize])}px` }} aria-hidden="true">
                  Aa
                </span>
                <span>{t(`settings.textSizes.${textSize}`)}</span>
              </button>
            ))}
          </div>
          <p className="hh-caption hh-row-note" id={`${sizeId}-hint`}>
            {t("settings.textSizeHint", { mod: ZOOM_KEY })}
          </p>
        </div>
        {state.config.folder && (
          <div className="hh-row">
            <span className="hh-row-label">{t("settings.folder")}</span>
            <code>{state.config.folder}</code>
            <button onClick={() => void client.revealFolder()}>{t("settings.reveal")}</button>
            {offerMove && (
              <button ref={toggleRef} aria-expanded={moveOpen} aria-controls={placesId} onClick={() => setMoveOpen((o) => !o)}>
                {t("backup.moveFolder")}
              </button>
            )}
          </div>
        )}
        {state.config.folder && offerMove && moveOpen && (
          <div id={placesId} className="hh-row">
            <MovePlaces state={state} move={move} />
          </div>
        )}
        {state.config.folder && backupText && (
          <div className="hh-row">
            <span className="hh-row-label">{t("backup.title")}</span>
            <span>{backupText}</span>
            {dismissed && <button onClick={() => void save({ backupDismissed: false })}>{t("backup.showAgain")}</button>}
          </div>
        )}
      </div>
      {state.config.folder && <p className="hh-caption">{t("settings.folderFixed")}</p>}
      {state.parallel && <ParallelSection state={state} save={saveOrFail} />}
      {state.profiles && <ProfilesSection client={client} state={state} onChange={onChange} />}
      <BackupNotice client={client} state={state} onChange={onChange} move={move} />

      <h3>{t("settings.about")}</h3>
      <div className="hh-rows">
        <div className="hh-row">
          <span className="hh-display">{state.harness.name}</span>
          <span className="hh-caption">{t("settings.version", { version: state.harness.version })}</span>
        </div>
        <div className="hh-row">
          <span>{t("settings.madeBy", { author: state.harness.author })}</span>
          {state.harness.donate && (
            <a className="hh-button" href={state.harness.donate} target="_blank" rel="noreferrer">
              {t("settings.support")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const CAP_CHOICES = Array.from({ length: PARALLEL_MAX }, (_, i) => i + 1);

/**
 * Settings › General for a harness that declares `parallel` (spec §7, §9.2): how many tasks and jobs run at once, and
 * the notification when a task waits. A cap saves the person's whole `parallel` (the store merges the top level only),
 * so the other cap they set stays; one they never set keeps following the manifest. An engine not yet checked with
 * two sessions holds both at 1.
 */
function ParallelSection({ state, save }: { state: AppState; save: (patch: AppConfig) => Promise<unknown> }) {
  const { t } = useTranslation();
  const id = useId();
  // A failed save says so (as Settings › Jobs does) and rejects inside `latest.save`, so its value is dropped.
  const [saveFailed, setSaveFailed] = useState(false);
  const said = (saving: Promise<unknown>) =>
    void saving.then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  const info = state.parallel!;
  const held = info.heldReason === "engine";
  const engine = state.engines.find((e) => e.id === state.config.engineId)?.name ?? state.config.engineId ?? "";
  // The other cap may still be on its way to main: each save builds on the last one asked for, not on `state`.
  const latest = useLatestConfig(state.config.parallel);
  const cap = (key: "tasks" | "jobs", label: string) => (
    <div className="hh-row">
      <label className="hh-row-label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <select
        id={`${id}-${key}`}
        value={info.caps[key]}
        disabled={held}
        aria-describedby={held ? `${id}-held` : undefined}
        onChange={(e) => said(latest.save({ ...latest.get(), [key]: Number(e.target.value) }, (parallel) => save({ parallel })))}
      >
        {CAP_CHOICES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <>
      <h3>{t("parallel.parallelSection")}</h3>
      <div className="hh-rows">
        {cap("tasks", t("parallel.tasksAtOnce"))}
        {cap("jobs", t("parallel.jobsAtOnce"))}
        {held && (
          <p className="hh-caption hh-row-note" id={`${id}-held`}>
            {t("parallel.engineHeld", { engine })}
          </p>
        )}
        <div className="hh-row">
          <label>
            <input type="checkbox" checked={info.notifyWaiting} onChange={(e) => said(save({ notifyWaiting: e.target.checked }))} /> {t("parallel.notifyWaiting")}
          </label>
        </div>
      </div>
      {saveFailed && <p role="alert">{t("parallel.saveFailed")}</p>}
    </>
  );
}

/** The harness's tab, Engine, Models and Usage before the app is configured: they all lead to the setup flow. */
function NotConfigured({ state, onSetup }: { state: AppState; onSetup: (step?: string) => void }) {
  const { t } = useTranslation();
  const name = state.harness.name;
  return (
    <div className="hh-tab hh-not-configured">
      <EngineIcon size={40} />
      <h3>{t("setupFlow.notConfiguredTitle")}</h3>
      <p>{t("setupFlow.notConfiguredText")}</p>
      {/* No step: the click event must not arrive as one (the flow would open that step alone). */}
      <button className="hh-primary" onClick={() => onSetup()}>
        {t("setupFlow.configure", { name })}
      </button>
    </div>
  );
}
