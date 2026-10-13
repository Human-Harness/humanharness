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
  const locations = state.backup?.locations ?? [];
  // A synced place comes first (spec 3d §2): the folder survives losing the computer.
  const [folder, setFolder] = useState(locations[0]?.suggested ?? state.suggestedFolder);
  const [problem, setProblem] = useState<FolderProblem | null>(null);
  const [saveError, setSaveError] = useState(false);
  const choose = (next: string) => {
    setFolder(next);
    setProblem(null);
  };

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
      {locations.length > 0 && (
        <>
          <div className="hh-places" role="group" aria-label={t("backup.placesLabel")}>
            {locations.map((l) => (
              <button key={l.path} type="button" aria-pressed={folder === l.suggested} onClick={() => choose(l.suggested)}>
                {t("backup.saveIn", { provider: t(`backup.provider.${l.provider}`) })}
              </button>
            ))}
            <button type="button" aria-pressed={folder === state.suggestedFolder} onClick={() => choose(state.suggestedFolder)}>
              {t("backup.thisComputer")}
            </button>
          </div>
          <p className="hh-caption">{t("backup.placesHint")}</p>
        </>
      )}
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
