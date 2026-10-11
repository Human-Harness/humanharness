import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { AppState, FolderProblem, HarnessClient } from "./client";

/** The current UI language as a harness language. */
export function uiLanguage(state: AppState, i18nLanguage: string): Language {
  const languages = state.harness.languages;
  return state.config.language ?? (languages.includes(i18nLanguage as Language) ? (i18nLanguage as Language) : languages[0]);
}

/** First launch only: the welcome line and the folder (spec §7: chosen once, then fixed). Saves the language with it. */
export function FolderStep({ client, state, onSaved }: { client: HarnessClient; state: AppState; onSaved: (s: AppState) => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const [folder, setFolder] = useState(state.suggestedFolder);
  const [problem, setProblem] = useState<FolderProblem | null>(null);
  const [saveError, setSaveError] = useState(false);

  const pick = async () => {
    const result = await client.pickFolder(folder).catch(() => null);
    if (!result) return;
    setProblem(result.problem);
    if (!result.problem) setFolder(result.folder);
  };
  const save = async () => {
    setSaveError(false);
    try {
      onSaved(await client.saveConfig({ language: lang, folder }));
    } catch {
      setSaveError(true);
    }
  };

  return (
    <section className="hh-onboarding">
      <p>{t("setup.welcome", { name: state.harness.name[lang] })}</p>
      <h3>{t("setup.folder")}</h3>
      <p className="hh-caption">{t("setup.folderHint")}</p>
      <div className="hh-rows">
        <div className="hh-row">
          <code>{folder}</code>
          <button onClick={() => void pick()}>{t("setup.folderChange")}</button>
        </div>
      </div>
      {problem && (
        <p className="hh-folder-problem" role="alert">
          {t(`setup.folderProblem.${problem}`)}
        </p>
      )}
      <p className="hh-caption">{t("setup.folderWarning")}</p>
      <button className="hh-primary" onClick={() => void save()}>
        {t("setup.useFolder")}
      </button>
      {saveError && (
        <p className="hh-save-error" role="alert">
          {t("setup.saveError")}
        </p>
      )}
    </section>
  );
}
