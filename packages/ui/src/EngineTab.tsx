import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppState, type EngineStatus, type HarnessClient, engineProblem } from "./client";
import { EngineOnboarding } from "./EngineOnboarding";
import { FolderStep, uiLanguage } from "./FolderStep";

/** Settings → Engine: the folder on first launch, then engine tiles, onboarding and the engine in use. */
export function EngineTab({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const current = state.config.engineId;
  const [selected, setSelected] = useState(current ?? state.engines[0]?.id);
  const [statuses, setStatuses] = useState<Record<string, EngineStatus>>({});
  const [busy, setBusy] = useState<null | "use" | "logout">(null);
  const [failed, setFailed] = useState(false);
  const ids = state.engines.map((e) => e.id).join(",");
  const hasFolder = Boolean(state.config.folder);

  const refresh = useCallback(
    async (id: string) => {
      try {
        const status = await client.engineStatus(id);
        setStatuses((all) => ({ ...all, [id]: status }));
      } catch {
        setFailed(true);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!hasFolder) return;
    for (const id of ids.split(",").filter(Boolean)) void refresh(id);
  }, [hasFolder, ids, refresh]);

  if (!hasFolder) return <FolderStep client={client} state={state} onSaved={onChange} />;

  const engine = state.engines.find((e) => e.id === selected);
  const status = selected ? statuses[selected] : undefined;
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
          const label = !s ? t("home.checking") : engineProblem(s) === null ? t("home.connected") : t("home.notConnected");
          return (
            <button key={e.id} type="button" className="hh-tile" aria-pressed={selected === e.id} onClick={() => setSelected(e.id)}>
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

      {engine && !status && <p role="status">{t("engine.checking", { engine: engine.name })}</p>}
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
