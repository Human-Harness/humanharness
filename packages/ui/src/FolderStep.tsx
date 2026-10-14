import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { AppState, FolderProblem, HarnessClient } from "./client";

/** The current UI language as a harness language. */
export function uiLanguage(state: AppState, i18nLanguage: string): Language {
  const languages = state.harness.languages;
  return state.config.language ?? (languages.includes(i18nLanguage as Language) ? (i18nLanguage as Language) : languages[0]);
}

/** First launch only: the welcome line and the folder (spec §7: chosen once, then fixed). Saves the language with it. */
export function FolderStep({
  client,
  state,
  onSaved,
  formId,
  welcome = true,
}: {
  client: HarnessClient;
  state: AppState;
  onSaved: (s: AppState) => void;
  /** Set by the setup flow: the step shows no save button of its own; a button in the footer with `form={formId}` submits it. */
  formId?: string;
  /** The welcome line; the setup flow leaves it out (it has its own heading and intro). */
  welcome?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLanguage(state, i18n.language);
  const locations = state.backup?.locations ?? [];
  // A synced place comes first (spec 3d §2): the folder survives losing the computer.
  // Back in the setup flow, the folder just saved is still the choice.
  const [folder, setFolder] = useState(state.config.folder ?? locations[0]?.suggested ?? state.suggestedFolder);
  const [problem, setProblem] = useState<FolderProblem | null>(null);
  const [saveError, setSaveError] = useState(false);
  const placesId = useId();
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
    <form
      className="hh-onboarding"
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {welcome && <p>{t("setup.welcome", { name: state.harness.name[lang] })}</p>}
      <h3>{t("setup.folder")}</h3>
      <p className="hh-caption">{t("setup.folderHint")}</p>
      {locations.length > 0 && (
        <>
          <div className="hh-places" role="radiogroup" aria-label={t("backup.placesLabel")}>
            {locations.map((l, i) => (
              <label key={l.path} className="hh-place">
                <input
                  type="radio"
                  name={`${placesId}-place`}
                  checked={folder === l.suggested}
                  onChange={() => choose(l.suggested)}
                  aria-labelledby={`${placesId}-${i}-name`}
                  aria-describedby={l.account ? `${placesId}-${i}-account` : undefined}
                />
                <span id={`${placesId}-${i}-name`}>{t("backup.saveIn", { provider: t(`backup.provider.${l.provider}`) })}</span>
                {/* Two accounts of one provider would read the same: the account tells them apart. */}
                {l.account && (
                  <span className="hh-caption" id={`${placesId}-${i}-account`}>
                    {l.account}
                  </span>
                )}
              </label>
            ))}
            <label className="hh-place">
              <input type="radio" name={`${placesId}-place`} checked={folder === state.suggestedFolder} onChange={() => choose(state.suggestedFolder)} />
              <span>{t("backup.thisComputer")}</span>
            </label>
          </div>
          <p className="hh-caption">{t("backup.placesHint")}</p>
        </>
      )}
      <div className="hh-rows">
        <div className="hh-row">
          <code>{folder}</code>
          <button type="button" onClick={() => void pick()}>
            {t("setup.folderChange")}
          </button>
        </div>
      </div>
      {problem && (
        <p className="hh-folder-problem" role="alert">
          {t(`setup.folderProblem.${problem}`)}
        </p>
      )}
      <p className="hh-caption">{t("setup.folderWarning")}</p>
      {!formId && (
        <button type="submit" className="hh-primary">
          {t("setup.useFolder")}
        </button>
      )}
      {saveError && (
        <p className="hh-save-error" role="alert">
          {t("setup.saveError")}
        </p>
      )}
    </form>
  );
}
