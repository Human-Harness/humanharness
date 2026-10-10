import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { AppConfig, AppState, HarnessClient } from "./client";

const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

export function SetupScreen({ client, state, onDone }: { client: HarnessClient; state: AppState; onDone: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState<Language>(() => (state.config.language ?? (i18n.language as Language)) || "en");
  const [folder, setFolder] = useState(state.config.folder ?? state.suggestedFolder);
  const [engineId, setEngineId] = useState(state.config.engineId ?? state.engines[0]?.id);

  const changeLanguage = (language: Language) => {
    setLang(language);
    void i18n.changeLanguage(language);
    client.saveConfig({ language }).catch(() => {});
  };
  const start = async () => {
    const config: AppConfig = { language: lang, folder, engineId };
    onDone(await client.saveConfig(config));
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
        <button onClick={() => void client.pickFolder(folder).then((f) => f && setFolder(f))}>{t("setup.folderChange")}</button>
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
    </main>
  );
}
