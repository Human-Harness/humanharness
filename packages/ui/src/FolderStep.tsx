import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, FolderProblem, HarnessClient } from "./client";
import { systemLanguage } from "./language";
import { Rx } from "./guide";

/**
 * The setup flow's folder step (spec §7: chosen once, then fixed). Saves the language with it. It shows no save
 * button of its own: a button in the flow's action bar with `form={formId}` submits it. The places are a RadioGroup
 * (Marco, 2026-11-04): the place's name, the account in grey under it; the path below with "Choose another folder".
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
  const ids = useId();
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
    <Rx.Card size="3" asChild>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Rx.Flex direction="column" gap="4">
          <Rx.Flex direction="column" gap="1">
            <Rx.Heading as="h3" size="3">
              {t("setup.folder")}
            </Rx.Heading>
            <Rx.Text as="p" size="2" color="gray">
              {t("setup.folderHint")}
            </Rx.Text>
          </Rx.Flex>
          {locations.length > 0 && (
            <Rx.Flex direction="column" gap="2">
              {/* A folder picked by hand matches no place: then none is checked. */}
              <Rx.RadioGroup.Root value={folder} onValueChange={choose} aria-label={t("backup.placesLabel")}>
                <Rx.Flex direction="column" gap="3">
                  {locations.map((l, i) => (
                    // Named by the place alone, described by the account: two accounts of one provider read the same
                    // name, and the account tells them apart.
                    <Rx.RadioGroup.Item
                      key={l.path}
                      value={l.suggested}
                      aria-labelledby={`${ids}-${i}`}
                      aria-describedby={l.account ? `${ids}-${i}-account` : undefined}
                    >
                      <Rx.Flex direction="column" gap="1">
                        <Rx.Text size="2" weight="medium" id={`${ids}-${i}`}>
                          {t("backup.saveIn", { provider: t(`backup.provider.${l.provider}`) })}
                        </Rx.Text>
                        {l.account && (
                          <Rx.Text size="1" color="gray" id={`${ids}-${i}-account`}>
                            {l.account}
                          </Rx.Text>
                        )}
                      </Rx.Flex>
                    </Rx.RadioGroup.Item>
                  ))}
                  <Rx.RadioGroup.Item value={state.suggestedFolder}>
                    <Rx.Text size="2" weight="medium">
                      {t("backup.thisComputer")}
                    </Rx.Text>
                  </Rx.RadioGroup.Item>
                </Rx.Flex>
              </Rx.RadioGroup.Root>
              <Rx.Text as="p" size="1" color="gray">
                {t("backup.placesHint")}
              </Rx.Text>
            </Rx.Flex>
          )}
          <Rx.Separator size="4" />
          <Rx.Flex align="center" justify="between" gap="3" wrap="wrap">
            {folder && (
              <Rx.Text size="2" className="hh-gd-path">
                <bdi dir="ltr">{folder}</bdi>
              </Rx.Text>
            )}
            <Rx.Button type="button" size="1" variant="outline" color="gray" onClick={() => void pick()}>
              {t("setup.folderChange")}
            </Rx.Button>
          </Rx.Flex>
          {problem && (
            <Rx.Callout.Root color="red" role="alert">
              <Rx.Callout.Text>{t(`setup.folderProblem.${problem}`)}</Rx.Callout.Text>
            </Rx.Callout.Root>
          )}
          <Rx.Text as="p" size="1" color="gray">
            {t("setup.folderWarning")}
          </Rx.Text>
          {saveError && (
            <Rx.Callout.Root color="red" role="alert">
              <Rx.Callout.Text>{t("setup.saveError")}</Rx.Callout.Text>
            </Rx.Callout.Root>
          )}
        </Rx.Flex>
      </form>
    </Rx.Card>
  );
}
