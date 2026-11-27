import { defineMod } from "@humanharness/mod-sdk";
import type { CoreUiCtx, SettingsTabProps } from "@humanharness/ui";
import { UsageTab } from "./UsageTab";

/** Settings › Usage: what the engine reported about the plan and how much each topic uses (the tab the core drew before). */
function Tab({ client, state }: SettingsTabProps) {
  return <UsageTab client={client} state={state} />;
}

export default defineMod({
  id: "usage",
  ui: (ctx: CoreUiCtx) => {
    ctx.settingsTab("usage", Tab, { label: "Usage" });
  },
});
