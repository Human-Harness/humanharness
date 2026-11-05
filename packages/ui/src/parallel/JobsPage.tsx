import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient } from "../client";
import { SecondaryPage } from "../guide";
import { JobsTab } from "./JobsTab";

/**
 * Rail › Jobs (DESIGN.md "Secondary pages", stage 4a): the jobs on their own page, the same cards as Settings › Jobs
 * (one card per job: toggle, frequency, daily cap and its runs as foldable rows).
 */
export function JobsPage({
  client,
  state,
  focusKey,
  onChange,
  onBack,
  onStartAction,
}: {
  client: HarnessClient;
  state: AppState;
  focusKey?: number;
  onChange: (state: AppState) => void;
  onBack?: () => void;
  onStartAction?: (action: string, scope: string | null) => boolean;
}) {
  const { t } = useTranslation();
  return (
    <SecondaryPage title={t("rail.jobs")} line={t("settings.line.jobs")} focusKey={focusKey} {...(onBack ? { onBack } : {})}>
      <JobsTab client={client} state={state} onChange={onChange} headless {...(onStartAction ? { onStartAction } : {})} />
    </SecondaryPage>
  );
}
