// Settings and actions in ⌘K (search spec §6): matched in the window, never stored (§4.2, plan deviations 1–2).
import type { SearchCommandId, SearchMarked, SearchSettingsTab } from "./views";

/** Case and accents folded, as `packages/search` folds the index (`fold`). */
export const foldText = (s: string): string => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const words = (s: string): string[] => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 2: every typed word starts a word of the label; 1: of the label, its section or a keyword; 0: no match. */
export function localScore(query: string, label: string, extra: readonly string[]): number {
  const q = words(query);
  if (q.length === 0) return 0;
  const own = words(label);
  if (q.every((w) => own.some((x) => x.startsWith(w)))) return 2;
  const all = [...own, ...extra.flatMap(words)];
  return q.every((w) => all.some((x) => x.startsWith(w))) ? 1 : 0;
}

/** The label with the typed prefix of each matching word marked. */
export function markLocal(label: string, query: string): SearchMarked {
  const q = words(query).sort((a, b) => b.length - a.length);
  const out: SearchMarked = [];
  let at = 0;
  for (const m of label.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = q.find((x) => foldText(m[0]).startsWith(x));
    if (!w || m.index === undefined) continue;
    const end = m.index + Math.min(w.length, m[0].length);
    if (m.index > at) out.push({ text: label.slice(at, m.index) });
    out.push({ text: label.slice(m.index, end), mark: true });
    at = end;
  }
  if (at < label.length) out.push({ text: label.slice(at) });
  return out;
}

/** What a setting row needs to be on screen (the tab's own conditions are `visibleTabs`'). */
export type SettingNeed = "configured" | "folder" | "backup" | "parallel" | "profiles";

export interface SearchableSetting {
  /** `<tab>.<field>`: the row's `data-setting`. */
  id: string;
  tab: SearchSettingsTab;
  /** An i18n key: the row's label as Settings shows it. */
  label: string;
  /** Other words that find it, in English (plan deviation 2). Never a word starting "guide" or "old" (plan 1's tests). */
  keywords?: readonly string[];
  needs?: readonly SettingNeed[];
}

/**
 * Every Settings row search opens (§6; plan deviation 12). A registry test keeps it and the tabs in step. Only labels
 * and keywords become row text: no row ever shows a setting's value (a connection's token, a key).
 */
export const SEARCHABLE_SETTINGS: readonly SearchableSetting[] = [
  { id: "general.language", tab: "general", label: "settings.language", keywords: ["translate", "locale"] },
  { id: "general.appearance", tab: "general", label: "settings.appearance", keywords: ["theme", "dark", "light", "mode"] },
  { id: "general.textSize", tab: "general", label: "settings.textSize", keywords: ["font", "zoom", "bigger", "smaller"] },
  { id: "general.folder", tab: "general", label: "settings.folder", keywords: ["move", "location", "finder"], needs: ["folder"] },
  { id: "general.backup", tab: "general", label: "backup.title", keywords: ["sync", "icloud", "dropbox"], needs: ["folder", "backup"] },
  { id: "general.tasksAtOnce", tab: "general", label: "parallel.tasksAtOnce", keywords: ["parallel"], needs: ["parallel"] },
  { id: "general.jobsAtOnce", tab: "general", label: "parallel.jobsAtOnce", keywords: ["parallel"], needs: ["parallel"] },
  { id: "general.notifyWaiting", tab: "general", label: "parallel.notifyWaiting", keywords: ["notification", "alert"], needs: ["parallel"] },
  { id: "general.profiles", tab: "general", label: "profiles.sectionTitle", keywords: ["profiles", "people", "users"], needs: ["profiles"] },
  { id: "engine.engine", tab: "engine", label: "engine.tilesLabel", keywords: ["engine", "provider", "claude", "codex", "gemini", "sign in"], needs: ["configured"] },
  { id: "models.tasks", tab: "models", label: "models.tasks", keywords: ["models", "tier", "pinned", "budget"], needs: ["configured"] },
  { id: "models.levels", tab: "models", label: "models.levels", keywords: ["models", "light", "standard", "deep"], needs: ["configured"] },
  { id: "sidekick.on", tab: "sidekick", label: "sidekick.settings.on", keywords: ["coach"], needs: ["configured"] },
  { id: "sidekick.preSend", tab: "sidekick", label: "sidekick.settings.preSend", keywords: ["sidekick"], needs: ["configured"] },
  { id: "sidekick.afterReply", tab: "sidekick", label: "sidekick.settings.afterReply", keywords: ["sidekick"], needs: ["configured"] },
  { id: "sidekick.headsUps", tab: "sidekick", label: "sidekick.settings.headsUps", keywords: ["sidekick"], needs: ["configured"] },
  { id: "sidekick.wait", tab: "sidekick", label: "sidekick.settings.wait", keywords: ["sidekick", "seconds"], needs: ["configured"] },
  { id: "sidekick.tier", tab: "sidekick", label: "sidekick.settings.tier", keywords: ["sidekick", "tier"], needs: ["configured"] },
  { id: "sidekick.cap", tab: "sidekick", label: "sidekick.settings.cap", keywords: ["sidekick", "tokens", "limit"], needs: ["configured"] },
  { id: "plugins.plugins", tab: "plugins", label: "plugins.tab", keywords: ["extensions", "turn on"], needs: ["configured"] },
  { id: "connections.connections", tab: "connections", label: "connections.tab", keywords: ["keys", "tokens", "secrets"], needs: ["configured"] },
  { id: "jobs.jobs", tab: "jobs", label: "parallel.jobsTab", keywords: ["schedule", "background"], needs: ["configured"] },
  { id: "usage.plan", tab: "usage", label: "usage.planTitle", keywords: ["usage", "limits", "plan"], needs: ["configured"] },
  { id: "usage.actions", tab: "usage", label: "usage.actionsTitle", keywords: ["usage", "tokens", "cost"], needs: ["configured"] },
];

/** The window's state a setting's `needs` read. */
export type SettingState = Record<SettingNeed, boolean>;
export const settingAvailable = (s: SearchableSetting, state: SettingState): boolean => (s.needs ?? []).every((n) => state[n]);

/** What the chat on screen says about itself; null away from it (home, setup). */
export interface ChatSearchContext {
  taskOpen: boolean;
  turnRunning: boolean;
  /** The task's next part while it waits for the person (flow harnesses with parts). */
  nextPart: { id: string; label: string } | null;
  /** The side panels can open (not the slim window). */
  panels: boolean;
}

export interface SearchCommandState {
  chat: ChatSearchContext | null;
  scopes: readonly { id: string; title: string; archived?: boolean }[];
  openScope: string | null;
  /** The Settings tabs this state shows. */
  tabs: readonly SearchSettingsTab[];
}

export interface SearchCommand {
  command: SearchCommandId;
  arg?: string;
  /** An i18n key under `search.command`. */
  label: string;
  vars?: Record<string, string>;
  /** English words that find it besides its label. */
  keywords: readonly string[];
}

/**
 * The commands available now (§6 `when`), in this order. A tab's or a scope's name is `vars` the window fills. None of
 * them sends anything: a new question only focuses the composer, a scope switch only opens the scope (plan deviation 14).
 */
export function searchCommands(s: SearchCommandState): SearchCommand[] {
  const out: SearchCommand[] = [];
  const c = s.chat;
  if (c && !c.taskOpen) out.push({ command: "new-question", label: "search.command.newQuestion", keywords: ["ask", "start", "chat"] });
  if (c?.panels) {
    out.push({ command: "open-history", label: "search.command.openHistory", keywords: ["past", "tasks"] });
    out.push({ command: "open-notes", label: "search.command.openNotes", keywords: ["clear so far"] });
    out.push({ command: "open-context", label: "search.command.openContext", keywords: ["tokens", "window"] });
  }
  if (c?.nextPart) out.push({ command: "next-part", arg: c.nextPart.id, label: "search.command.nextPart", vars: { part: c.nextPart.label }, keywords: ["phase", "step"] });
  if (c?.turnRunning) out.push({ command: "stop-turn", label: "search.command.stopTurn", keywords: ["cancel", "halt"] });
  for (const tab of s.tabs) out.push({ command: "open-settings", arg: tab, label: "search.command.openSettings", vars: { tab }, keywords: ["preferences"] });
  if (!c?.turnRunning) {
    for (const scope of s.scopes) {
      if (scope.archived || scope.id === s.openScope) continue;
      out.push({ command: "switch-scope", arg: scope.id, label: "search.command.switchScope", vars: { scope: scope.title }, keywords: ["open", "go"] });
    }
  }
  return out;
}
