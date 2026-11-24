import { type CoreUiCtx, type RowProps, Row, Rx, type SettingsAppProps, type SettingsTabProps, shownLanguage } from "@humanharness/ui";
import { useTranslation } from "react-i18next";
import { SidekickTab, sidekickTitleKey } from "./SidekickTab";
import { useSidekick } from "./useSidekick";

/** Settings › Sidekick(s) (spec §8); "Open Settings › Sidekick" on Models goes to Models. */
function Tab({ openTab, client, state }: SettingsTabProps) {
  return <SidekickTab client={client} onModels={() => openTab("models")} scopes={state.scopes} />;
}

/** The tab reads as the section's title (spec §8): "Sidekicks" once there are two or more. */
function useTabLabel({ client, state }: SettingsAppProps): string {
  const { t } = useTranslation();
  const sk = useSidekick(client, state.sidekick !== undefined);
  return t(sidekickTitleKey(sk?.sidekicks));
}

/** Sidekick's task row in Settings › Models, after the core's (spec §5), drawn the core's way. */
function ModelsRow({ taskRow }: RowProps) {
  const { t } = useTranslation();
  return <>{taskRow?.({ key: "sidekick", label: t("sidekick.models.label"), description: t("sidekick.models.hint") })}</>;
}

/** Sidekick's tokens in Settings › Usage, apart from the tasks (spec §8). */
function UsageLine({ usage }: RowProps) {
  const { t, i18n } = useTranslation();
  const label = t("usage.row.sidekick");
  const tokens = usage?.sidekick ?? 0;
  return (
    <Row label={label} aria-label={label}>
      <Rx.Text size="2" color="gray">
        {t("usage.aboutTokens", { tokens: tokens.toLocaleString(shownLanguage(i18n)) })}
      </Rx.Text>
    </Row>
  );
}

/** Sidekick's parts of Settings: its tab, its Models row and its Usage line, each only while main sends Sidekick (D0). */
export function settingsParts(ctx: CoreUiCtx) {
  ctx.settingsTab("sidekick", Tab, { label: "Sidekick", shown: (state) => state.sidekick !== undefined, useLabel: useTabLabel });
  ctx.row("models", ModelsRow, { shown: ({ state }) => state.sidekick !== undefined });
  // The line only once Sidekick has run.
  ctx.row("usage", UsageLine, { shown: ({ usage }) => usage?.sidekick !== undefined });
}
