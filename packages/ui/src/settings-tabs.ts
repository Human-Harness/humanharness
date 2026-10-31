import type { TFunction } from "i18next";
import type { AppState, SearchSettingsTab } from "./client";

// Settings' tabs, apart from the sheet: search's rows read them without loading the sheet's components.
export type SettingsTab = SearchSettingsTab;
/**
 * `harness` is the harness's own tab (manifest `settings`), right after General (harness-settings spec §4); Sidekick
 * after Models (sidekick spec §8); Plugins after Sidekick (plugins spec §7); Connections after Plugins (tools spec §9);
 * Jobs before Usage (parallel spec §9).
 */
const TABS: SettingsTab[] = ["general", "harness", "engine", "models", "sidekick", "plugins", "connections", "jobs", "usage"];
/** The tabs this state shows (the sheet's own list, and search's: a row of a hidden tab isn't offered). */
export function visibleTabs(state: AppState): SettingsTab[] {
  return TABS.filter(
    (id) =>
      (id !== "models" || state.models !== undefined) &&
      (id !== "harness" || state.settings !== undefined || state.setup !== undefined) &&
      (id !== "sidekick" || state.sidekick !== undefined) &&
      (id !== "plugins" || state.plugins !== undefined) &&
      (id !== "connections" || state.connections !== undefined) &&
      (id !== "jobs" || state.jobs !== undefined),
  );
}

/** A tab's name as its button says it ("Sidekicks" with several: the button passes its own `sidekick`). */
export function tabLabel(t: TFunction, state: AppState, id: SettingsTab, sidekick = t("sidekick.tab")): string {
  return id === "harness" ? (state.settings?.tab ?? t("settings.tabs.setup")) : id === "sidekick" ? sidekick : id === "plugins" ? t("plugins.tab") : id === "connections" ? t("connections.tab") : id === "jobs" ? t("parallel.jobsTab") : t(`settings.tabs.${id}`);
}

