import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { AppConfig, AppState, FolderProblem, HarnessClient } from "./client";

const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

export function SetupScreen({ client, state, onDone }: { client: HarnessClient; state: AppState; onDone: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState<Language>(() => (state.config.language ?? (i18n.language as Language)) || "en");
  const [folder, setFolder] = useState(state.config.folder ?? state.suggestedFolder);
  const [engineId, setEngineId] = useState(state.config.engineId ?? state.engines[0]?.id);
  const [folderProblem, setFolderProblem] = useState<FolderProblem | null>(null);
  const [saveError, setSaveError] = useState(false);

  const changeLanguage = (language: Language) => {
    setLang(language);
    void i18n.changeLanguage(language);
    client.saveConfig({ language }).catch(() => {});
  };
  const pickFolder = async () => {
    const pick = await client.pickFolder(folder).catch(() => null);
    if (!pick) return;
    setFolderProblem(pick.problem);
    if (!pick.problem) setFolder(pick.folder);
  };
  const start = async () => {
    const config: AppConfig = { language: lang, folder, engineId };
    setSaveError(false);
    let next: AppState;
    try {
      next = await client.saveConfig(config);
    } catch {
      setSaveError(true);
      return;
    }
    onDone(next);
  };

  return (
    <main className="hh-setup">
      <h1>{t("setup.title", { name: state.harness.name[lang] })}</h1>

      <fieldset>
        <legend>{t("setup.language")}</legend>
        {state.harness.languages.map((l) => (
          <label key={l}>
            <input type="radio" name="language" checked={lang === l} onChange={() => changeLanguage(l)} />
            {LANGUAGE_NAMES[l]}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>{t("setup.folder")}</legend>
        <p>{t("setup.folderHint")}</p>
        <code>{folder}</code>
        <button onClick={() => void pickFolder()}>{t("setup.folderChange")}</button>
        {folderProblem && (
          <p className="hh-folder-problem" role="alert">
            {t(`setup.folderProblem.${folderProblem}`)}
          </p>
        )}
        <p className="hh-warning">{t("setup.folderWarning")}</p>
      </fieldset>

      <fieldset>
        <legend>{t("setup.engine")}</legend>
        <p>{t("setup.engineHint")}</p>
        {state.engines.map((e) => (
          <label key={e.id} className="hh-engine">
            <input type="radio" name="engine" checked={engineId === e.id} onChange={() => setEngineId(e.id)} />
            <strong>{e.name}</strong>
            <span>{t("setup.engineRequires", { plan: e.requires[lang] })}</span>
            <span>{t("setup.engineData", { where: e.dataLocation[lang] })}</span>
            {e.status === "pending" && <em>{t("setup.enginePending")}</em>}
          </label>
        ))}
      </fieldset>

      <button className="hh-primary" disabled={!folder || !engineId} onClick={() => void start()}>
        {t("setup.start")}
      </button>
      {saveError && (
        <p className="hh-save-error" role="alert">
          {t("setup.saveError")}
        </p>
      )}
    </main>
  );
}
