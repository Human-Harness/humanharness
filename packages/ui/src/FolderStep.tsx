import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, FolderProblem, HarnessClient } from "./client";
import { systemLanguage } from "./language";
import { Option, OptionGroup } from "./guide/Option";

/**
 * The setup flow's folder step (spec §7: chosen once, then fixed). Saves the language with it. It shows no save
 * button of its own: a button in the flow's footer with `form={formId}` submits it.
 */
export function FolderStep({ client, state, onSaved, formId }: { client: HarnessClient; state: AppState; onSaved: (s: AppState) => void; formId: string }) {
  const { t } = useTranslation();
  const lang = state.config.language ?? systemLanguage();
  const locations = state.backup?.locations ?? [];
  // A synced place comes first (spec 3d §2): the folder survives losing the computer.
  // Back in the setup flow, the folder just saved is still the choice.
  const [folder, setFolder] = useState(state.config.folder ?? locations[0]?.suggested ?? state.suggestedFolder);
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
    <form
      className="hh-onboarding"
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3>{t("setup.folder")}</h3>
      <p className="hh-caption">{t("setup.folderHint")}</p>
      {locations.length > 0 && (
        <>
          <OptionGroup followFocus label={t("backup.placesLabel")}>
            {locations.map((l) => (
              <Option
                key={l.path}
                nameOnly
                checked={folder === l.suggested}
                onClick={() => choose(l.suggested)}
                title={t("backup.saveIn", { provider: t(`backup.provider.${l.provider}`) })}
                // Two accounts of one provider would read the same: the account tells them apart.
                description={l.account || undefined}
              />
            ))}
            <Option checked={folder === state.suggestedFolder} onClick={() => choose(state.suggestedFolder)} title={t("backup.thisComputer")} />
          </OptionGroup>
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
      {saveError && (
        <p className="hh-save-error" role="alert">
          {t("setup.saveError")}
        </p>
      )}
    </form>
  );
}
