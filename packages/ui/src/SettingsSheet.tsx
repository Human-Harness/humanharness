import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import { Segmented } from "./chrome";
import type { AppConfig, AppState, Appearance, HarnessClient, RunningSetup, UsageSummary } from "./client";
import { EngineTab } from "./EngineTab";
import { FolderStep, uiLanguage } from "./FolderStep";
import { WARN_AT, formatReset, percent } from "./usage";
import { useCurrentWindows } from "./UsageMeter";

export type SettingsTab = "general" | "engine" | "usage";
const TABS: SettingsTab[] = ["general", "engine", "usage"];
const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

/** The Settings sheet (spec 2026-10-11 "Settings sheet"): attached under the top bar, dimmed backdrop. */
export function SettingsSheet({
  client,
  state,
  tab,
  onTab,
  onChange,
  onClose,
}: {
  client: HarnessClient;
  state: AppState;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onChange: (state: AppState) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const runningId = useId();
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
            {TABS.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
                {t(`settings.tabs.${id}`)}
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
            {/* A sign-in shown on the Engine tab has its own Cancel next to the code field. */}
            {!(running.step === "login" && tab === "engine") && (
              <button onClick={() => void client.cancelSetup().catch(() => {})}>{t("settings.runningCancel")}</button>
            )}
          </div>
        )}
        <div role="tabpanel" aria-label={t(`settings.tabs.${tab}`)}>
          {tab === "general" && <GeneralTab client={client} state={state} onChange={onChange} />}
          {tab === "engine" && <EngineTab client={client} state={state} onChange={onChange} setupEngine={running?.engineId} />}
          {tab === "usage" && <UsageTab client={client} state={state} />}
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

function GeneralTab({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const save = (patch: AppConfig) => client.saveConfig(patch).then(onChange, () => {});
  const changeLanguage = (language: Language) => {
    void i18n.changeLanguage(language);
    void save({ language });
  };
  const appearances: { value: Appearance; label: string }[] = [
    { value: "system", label: t("settings.appearanceSystem") },
    { value: "light", label: t("settings.appearanceLight") },
    { value: "dark", label: t("settings.appearanceDark") },
  ];

  return (
    <div className="hh-tab">
      <div className="hh-rows">
        <div className="hh-row">
          <span className="hh-row-label">{t("settings.language")}</span>
          <Segmented
            label={t("settings.language")}
            value={lang}
            onChange={changeLanguage}
            options={state.harness.languages.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))}
          />
        </div>
        <div className="hh-row">
          <span className="hh-row-label">{t("settings.appearance")}</span>
          <Segmented label={t("settings.appearance")} value={state.config.appearance ?? "system"} onChange={(appearance) => void save({ appearance })} options={appearances} />
        </div>
        {state.config.folder && (
          <div className="hh-row">
            <span className="hh-row-label">{t("settings.folder")}</span>
            <code>{state.config.folder}</code>
            <button onClick={() => void client.revealFolder()}>{t("settings.reveal")}</button>
          </div>
        )}
      </div>
      {state.config.folder ? (
        <p className="hh-caption">{t("settings.folderFixed")}</p>
      ) : (
        <FolderStep client={client} state={state} onSaved={onChange} />
      )}

      <h3>{t("settings.about")}</h3>
      <div className="hh-rows">
        <div className="hh-row">
          <span className="hh-display">{state.harness.name[lang]}</span>
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

function UsageTab({ client, state }: { client: HarnessClient; state: AppState }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    client.getUsage().then(setUsage, () => setUsage({ limits: null, estimates: {} }));
  }, [client]);
  const limits = useCurrentWindows(usage?.limits ?? null);
  const engine = state.engines.find((e) => e.id === state.config.engineId);
  const actions = Object.entries(state.actions);

  let plan;
  if (!engine) plan = <p className="hh-caption">{t("home.noEngine")}</p>;
  else if (!engine.reportsLimits) plan = <p className="hh-caption">{t("usage.noLimits", { engine: engine.name })}</p>;
  else if (!limits?.length) plan = <p className="hh-caption">{t("usage.unknown")}</p>;
  else
    plan = (
      <div className="hh-rows">
        {limits.map((w) => (
          <div key={w.kind} className="hh-row">
            <span className={w.utilization >= WARN_AT ? "hh-warn" : undefined}>
              {t("usage.window", { label: t(`usage.${w.kind}`, { defaultValue: w.kind }), percent: percent(w.utilization) })}
            </span>
            <span className="hh-caption">{t("usage.resetsFull", { time: formatReset(w.resetsAt, i18n.language) })}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="hh-tab">
      <h3>{t("usage.planTitle")}</h3>
      {plan}
      <h3>{t("usage.actionsTitle")}</h3>
      {actions.length === 0 ? (
        <p className="hh-caption">{t("usage.noActions")}</p>
      ) : (
        <div className="hh-rows">
          {actions.map(([id, action]) => {
            const estimate = usage?.estimates[id];
            return (
              <div key={id} className="hh-row">
                <span>{action.label[lang]}</span>
                <span className={action.cost === "heavy" ? "hh-warn" : "hh-caption"}>
                  {t(`usage.cost.${action.cost}`)}
                  {estimate !== undefined ? ` · ${t("usage.estimate", { percent: Math.max(1, percent(estimate)) })}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
