import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppState, type EngineStatus, type HarnessClient, engineProblem } from "./client";
import { EngineOnboarding } from "./EngineOnboarding";
import { FolderStep, uiLanguage } from "./FolderStep";

/** Settings → Engine: the folder on first launch, then engine tiles, onboarding and the engine in use. */
export function EngineTab({
  client,
  state,
  onChange,
  setupEngine,
}: {
  client: HarnessClient;
  state: AppState;
  onChange: (s: AppState) => void;
  /** The engine whose install, update, sign-in or sign-out is running: its tile stays selected until it ends. */
  setupEngine?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const current = state.config.engineId;
  const [selected, setSelected] = useState(current ?? state.engines[0]?.id);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [busy, setBusy] = useState<null | "use" | "logout">(null);
  const [failed, setFailed] = useState(false);
  /** Why checking an engine failed, by engine id. */
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const ids = state.engines.map((e) => e.id).join(",");
  const hasFolder = Boolean(state.config.folder);

  const refresh = useCallback(
    async (id: string) => {
      setCheckErrors(({ [id]: _, ...rest }) => rest);
      try {
        const status = await client.engineStatus(id);
        setStatuses((all) => ({ ...all, [id]: status }));
      } catch (err) {
        setCheckErrors((all) => ({ ...all, [id]: err instanceof Error ? err.message : String(err) }));
      }
    },
    [client],
  );

  // A running step keeps its engine on screen (its progress is shown only there).
  useEffect(() => {
    if (setupEngine) setSelected(setupEngine);
  }, [setupEngine]);

  useEffect(() => {
    if (!hasFolder) return;
    for (const id of ids.split(",").filter(Boolean)) void refresh(id);
  }, [hasFolder, ids, refresh]);

  if (!hasFolder) return <FolderStep client={client} state={state} onSaved={onChange} />;

  const engine = state.engines.find((e) => e.id === selected);
  const checkError = selected ? checkErrors[selected] : undefined;
  const status = selected && checkError === undefined ? statuses[selected] : undefined;
  const ready = status ? engineProblem(status) === null : false;

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
              {e.logo && <img src={e.logo} alt="" />}
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
            {checkError && <pre>{checkError}</pre>}
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
          {selected !== current && (
            <button className="hh-primary" disabled={busy !== null} onClick={() => void use()}>
              {t("engine.use", { engine: engine.name })}
            </button>
          )}
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
            <div className="hh-row">
              <span className="hh-row-label">{t("engine.plan")}</span>
              <span>{engine.requires[lang]}</span>
            </div>
            <div className="hh-row">
              <span className="hh-row-label">{t("engine.data")}</span>
              <span>{engine.dataLocation[lang]}</span>
            </div>
            <div className="hh-row">
              <span className="hh-row-label">{t("engine.version")}</span>
              <span>{status.version}</span>
            </div>
          </div>
          <p className="hh-caption">{t("engine.noticeContent", { provider: engine.provider })}</p>
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
