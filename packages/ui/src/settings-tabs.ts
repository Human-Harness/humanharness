import type { TFunction } from "i18next";
import type { AppState, SearchSettingsTab } from "./client";
import { type BlockRegistry, appRegistry } from "./layout/registry";

// Settings' tabs, apart from the sheet: search's rows read them without loading the sheet's components. Mods (minimal-core
// spec §3.1) is a tab search doesn't open yet: `SearchSettingsTab` lives in the protocol's views.
export type SettingsTab = SearchSettingsTab | "mods" | ModTab;
/** A tab a mod put in Settings (`ctx.settingsTab(name, …)`): its id is the name the mod gave it. */
export type ModTab = string & {};
/**
 * The tabs search may open (every tab but Mods). A mod's tab is offered too: search's command opens it by its id
 * (its `SearchSettingsTab` typing is the protocol's, which names only the core's tabs).
 */
export const searchable = (id: SettingsTab): id is SearchSettingsTab => id !== "mods";
/**
 * `harness` is the harness's own tab (manifest `settings`), right after General (harness-settings spec §4); Sidekick
 * after Models (sidekick spec §8); Plugins after Sidekick (plugins spec §7); Connections after Plugins (tools spec §9);
 * Jobs before Usage (parallel spec §9); Mods after Sidekick, always shown: it is core (minimal-core spec §3.1).
 */
const TABS: SettingsTab[] = ["general", "harness", "engine", "models", "sidekick", "mods", "plugins", "connections", "jobs", "usage"];
/**
 * The tabs this state shows (the sheet's own list, and search's: a row of a hidden tab isn't offered). Mods' tabs go
 * right after Models and Sidekick, before Mods, in the order they were registered; a name a core tab has is not
 * added twice.
 */
export function visibleTabs(state: AppState, registry: BlockRegistry = appRegistry): SettingsTab[] {
  const core = TABS.filter(
    (id) =>
      (id !== "models" || state.models !== undefined) &&
      (id !== "harness" || state.settings !== undefined || state.setup !== undefined) &&
      (id !== "sidekick" || state.sidekick !== undefined) &&
      (id !== "plugins" || state.plugins !== undefined) &&
      (id !== "connections" || state.connections !== undefined) &&
      (id !== "jobs" || state.jobs !== undefined),
  );
  const own = modTabs(registry)
    .map((m) => m.name)
    .filter((name, i, all) => !TABS.includes(name) && all.indexOf(name) === i);
  const at = core.indexOf("mods");
  return [...core.slice(0, at), ...own, ...core.slice(at)];
}

/** The Settings tabs mods registered. */
export const modTabs = (registry: BlockRegistry = appRegistry) => registry.slot("settingsTab");

/** A tab's name as its button says it ("Sidekicks" with several: the button passes its own `sidekick`). */
export function tabLabel(t: TFunction, state: AppState, id: SettingsTab, sidekick = t("sidekick.tab"), registry: BlockRegistry = appRegistry): string {
  const mod = TABS.includes(id) ? undefined : modTabs(registry).find((m) => m.name === id);
  if (mod) return mod.label;
  return id === "harness" ? (state.settings?.tab ?? t("settings.tabs.setup")) : id === "sidekick" ? sidekick : id === "mods" ? t("mods.tab") : id === "plugins" ? t("plugins.tab") : id === "connections" ? t("connections.tab") : id === "jobs" ? t("parallel.jobsTab") : t(`settings.tabs.${id}`);
}

