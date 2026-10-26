import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupNotice, type FolderMove, MovePlaces, needsBackupNotice, useFolderMove } from "./BackupNotice";
import { EngineIcon, Segmented } from "./chrome";
import { type AppConfig, type AppState, type Appearance, type HarnessClient, type RunningSetup, TEXT_SIZES, type TextSize, isConfigured } from "./client";
import { EngineTab } from "./EngineTab";
import { HarnessSettingsTab } from "./HarnessSettingsTab";
import { ownName, systemLanguage } from "./language";
import { ModelsTab } from "./ModelsTab";
import { UsageTab } from "./UsageTab";

export type SettingsTab = "general" | "harness" | "engine" | "models" | "usage";
/** `harness` is the harness's own tab (manifest `settings`), right after General (harness-settings spec §4). */
const TABS: SettingsTab[] = ["general", "harness", "engine", "models", "usage"];
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
}: {
  client: HarnessClient;
  state: AppState;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onChange: (state: AppState) => void;
  onClose: () => void;
  /** Opens the setup flow (the empty state of Motor, Modelos and Uso before the app is configured). */
  onSetup: () => void;
  /** The app's folder move (HarnessApp), so a move outlives the sheet; without it the sheet keeps its own. */
  move?: FolderMove;
}) {
  const { t } = useTranslation();
  const own = useFolderMove(client, onChange);
  const move = shared ?? own;
  const runningId = useId();
  const baseId = useId();
  const tabId = (id: SettingsTab) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  // Models only shows when the main process sent its view (every packaged app does); the harness's tab only when it
  // declares settings (harness-settings D0).
  const tabs = TABS.filter((id) => (id !== "models" || state.models !== undefined) && (id !== "harness" || state.settings !== undefined));
  const configured = isConfigured(state.config);
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
      if (e.key === "Escape" && !runningRef.current) onCloseRef.current();
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
                {id === "harness" ? state.settings?.tab : t(`settings.tabs.${id}`)}
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
          {tab === "general" && <GeneralTab client={client} state={state} onChange={onChange} move={move} />}
          {tab !== "general" && !configured && <NotConfigured state={state} onSetup={onSetup} />}
          {tab === "engine" && configured && <EngineTab client={client} state={state} onChange={onChange} setupEngine={running?.engineId} />}
          {tab === "models" && configured && <ModelsTab client={client} state={state} onChange={onChange} />}
          {tab === "usage" && configured && <UsageTab client={client} state={state} />}
          {tab === "harness" && configured && state.settings && <HarnessSettingsTab client={client} view={state.settings} />}
        </div>
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab cycling inside the sheet (it is modal). */
function trapTab(sheet: HTMLElement, e: KeyboardEvent) {
  const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!sheet.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function GeneralTab({ client, state, onChange, move }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void; move: FolderMove }) {
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
  const lang = state.config.language ?? systemLanguage();
  const save = (patch: AppConfig) => client.saveConfig(patch).then(onChange, () => {});
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
        <div className="hh-row hh-row-wrap">
          <span className="hh-row-label">{t("settings.language")}</span>
          <span>{ownName(lang)}</span>
          <p className="hh-caption hh-row-note">{t("settings.languageHint")}</p>
        </div>
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

/** Motor, Modelos and Uso before the app is configured: they all lead to the setup flow. */
function NotConfigured({ state, onSetup }: { state: AppState; onSetup: () => void }) {
  const { t } = useTranslation();
  const name = state.harness.name;
  return (
    <div className="hh-tab hh-not-configured">
      <EngineIcon size={40} />
      <h3>{t("setupFlow.notConfiguredTitle")}</h3>
      <p>{t("setupFlow.notConfiguredText")}</p>
      <button className="hh-primary" onClick={onSetup}>
        {t("setupFlow.configure", { name })}
      </button>
    </div>
  );
}
