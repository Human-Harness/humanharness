import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EngineIcon } from "./chrome";
import { type AppState, type EngineStatus, type HarnessClient, engineProblem } from "./client";
import { EngineOnboarding, LegalInEnglish, useLegalLang } from "./EngineOnboarding";

/** The reason behind a failed call, without Electron's English "Error invoking remote method …: Error:" wrapper. */
export function errorDetail(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}

/** Settings → Engine (and the setup flow's engine step): engine tiles, onboarding and the engine in use. */
export function EngineTab({
  client,
  state,
  onChange,
  setupEngine,
  setup = false,
  onSelection,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (s: AppState) => void;
  /** The engine whose install, update, sign-in or sign-out is running: its tile stays selected until it ends. */
  setupEngine?: string;
  /** Shown as a step of the setup flow, which saves the engine itself: no "Use <engine>" button. */
  setup?: boolean;
  /** Told whenever the selected engine or its readiness changes. */
  onSelection?: (engineId: string, ready: boolean) => void;
}) {
  const { t } = useTranslation();
  const legalLang = useLegalLang();
  const current = state.config.engineId;
  const [selected, setSelected] = useState(current ?? state.engines[0]?.id);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [busy, setBusy] = useState<null | "use" | "logout">(null);
  const [failed, setFailed] = useState(false);
  /**
   * Signing out runs in Terminal (`terminalSteps.logout`): says to finish there, then check again.
   * "manual": the command was copied but Terminal did not open, so the person opens it by hand.
   */
  const [signOutHint, setSignOutHint] = useState<false | "opened" | "manual">(false);
  /** Why checking an engine failed, by engine id. */
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const ids = state.engines.map((e) => e.id).join(",");
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  const refresh = useCallback(
    async (id: string) => {
      setCheckErrors(({ [id]: _, ...rest }) => rest);
      try {
        const status = await client.engineStatus(id);
        setStatuses((all) => ({ ...all, [id]: status }));
      } catch (err) {
        setCheckErrors((all) => ({ ...all, [id]: errorDetail(err) }));
      }
    },
    [client],
  );

  // A running step keeps its engine on screen (its progress is shown only there).
  useEffect(() => {
    if (setupEngine) setSelected(setupEngine);
  }, [setupEngine]);

  useEffect(() => {
    for (const id of ids.split(",").filter(Boolean)) void refresh(id);
  }, [ids, refresh]);

  const engine = state.engines.find((e) => e.id === selected);
  const checkError = selected ? checkErrors[selected] : undefined;
  const status = selected && checkError === undefined ? statuses[selected] : undefined;
  const ready = status ? engineProblem(status) === null : false;

  useEffect(() => {
    if (selected) onSelectionRef.current?.(selected, ready);
  }, [selected, ready]);

  // The Terminal sign-out hint belongs to the engine it was shown for.
  useEffect(() => setSignOutHint(false), [selected]);

  const use = async () => {
    if (!selected) return;
    setBusy("use");
    setFailed(false);
    try {
      onChange(await client.saveConfig({ engineId: selected }));
    } catch {
      setFailed(true);
    }
    setBusy(null);
  };
  const signOut = async () => {
    if (!selected) return;
    // OpenCode (spec §2): the person signs out in Terminal; the app copies the command and opens it.
    if (engine?.terminalSteps?.logout) {
      setBusy("logout");
      setFailed(false);
      try {
        await client.copySetupCommand(selected, "logout");
        // The command is on the clipboard: a Terminal that does not open is a step to do by hand, not a failure.
        const opened = await client.openTerminal().then(
          () => true,
          () => false,
        );
        setSignOutHint(opened ? "opened" : "manual");
      } catch {
        setFailed(true);
      }
      setBusy(null);
      return;
    }
    setBusy("logout");
    setFailed(false);
    const result = await client.runSetup(selected, "logout").catch(() => ({ ok: false }));
    setBusy(null);
    await refresh(selected);
    if (!result.ok) setFailed(true);
  };

  return (
    <div className="hh-tab">
      <div className="hh-tiles" role="group" aria-label={t("engine.tilesLabel")}>
        {state.engines.map((e) => {
          const s = statuses[e.id];
          const label =
            checkErrors[e.id] !== undefined ? t("home.notConnected") : !s ? t("home.checking") : engineProblem(s) === null ? t("home.connected") : t("home.notConnected");
          return (
            <button
              key={e.id}
              type="button"
              className="hh-tile"
              aria-pressed={selected === e.id}
              disabled={setupEngine !== undefined && e.id !== setupEngine}
              onClick={() => setSelected(e.id)}
            >
              {selected === e.id && (
                <span className="hh-check" aria-hidden="true">
                  ✓
                </span>
              )}
              {e.logo ? <img src={e.logo} alt="" /> : <EngineIcon size={40} />}
              <strong>{e.name}</strong>
              <span className="hh-caption">{label}</span>
              {e.id === current && <span className="hh-caption">{t("engine.current")}</span>}
              {e.status === "pending" && <em className="hh-caption">{t("setup.enginePending")}</em>}
            </button>
          );
        })}
        <div className="hh-tile more" aria-disabled="true">
          {t("engine.moreSoon")}
        </div>
      </div>

      {engine && checkError !== undefined && (
        <div className="hh-onboarding">
          <div role="alert">
            <p>{t("engine.checkFailed", { engine: engine.name })}</p>
            {checkError && (
              <details>
                <summary>{t("engine.details")}</summary>
                <pre>{checkError}</pre>
              </details>
            )}
          </div>
          <button onClick={() => void refresh(engine.id)}>{t("engine.recheck")}</button>
        </div>
      )}
      {engine && checkError === undefined && !status && <p role="status">{t("engine.checking", { engine: engine.name })}</p>}
      {engine && status && !ready && (
        <EngineOnboarding key={engine.id} client={client} engine={engine} status={status} refresh={() => refresh(engine.id)} />
      )}
      {engine && status && ready && (
        <>
          {!setup && selected !== current && (
            <button className="hh-primary" disabled={busy !== null} onClick={() => void use()}>
              {t("engine.use", { engine: engine.name })}
            </button>
          )}
          {engine.mock ? (
            // The test engine: nothing to sign out of, no plan, no provider to disclose.
            <div className="hh-rows">
              <div className="hh-row">
                <span className="hh-row-label">{t("mock.model")}</span>
                <span>{t("mock.modelName")}</span>
              </div>
              <div className="hh-row">
                <span className="hh-row-label">{t("mock.answers")}</span>
                <span>{t("mock.answersValue")}</span>
              </div>
              <div className="hh-row">
                <span className="hh-row-label">{t("mock.data")}</span>
                <span>{t("mock.dataValue")}</span>
              </div>
              <div className="hh-row">
                <span className="hh-row-label">{t("mock.plan")}</span>
                <span>{t("mock.planValue")}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="hh-rows">
                <div className="hh-row">
                  <span>{t("engine.ready", { engine: engine.name })}</span>
                  {busy === "logout" ? (
                    <span role="status">{t("engine.signingOut")}</span>
                  ) : (
                    <button disabled={busy !== null} onClick={() => void signOut()}>
                      {t("engine.signOut")}
                    </button>
                  )}
                </div>
                {signOutHint && (
                  <div className="hh-row">
                    <span role="status">{t(signOutHint === "manual" ? "engine.signOutManual" : "engine.signOutTerminal")}</span>
                    <button onClick={() => void refresh(engine.id).then(() => setSignOutHint(false))}>{t("engine.providerRecheck")}</button>
                  </div>
                )}
                <div className="hh-row">
                  <span className="hh-row-label">{t("engine.plan")}</span>
                  <span>{engine.requires}</span>
                </div>
                <div className="hh-row">
                  <span className="hh-row-label">{t("engine.data")}</span>
                  <span>{engine.dataLocation}</span>
                </div>
                <div className="hh-row">
                  <span className="hh-row-label">{t("engine.version")}</span>
                  <span>{status.version}</span>
                </div>
              </div>
              <p className="hh-caption" lang={legalLang}>{t("legal.engine.noticeContent", { provider: engine.provider })}</p>
              <LegalInEnglish />
            </>
          )}
        </>
      )}
      {failed && (
        <p className="hh-save-error" role="alert">
          {t("engine.failed")}
        </p>
      )}
    </div>
  );
}
