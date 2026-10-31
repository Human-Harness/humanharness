import type { TFunction } from "i18next";
import { type AppState, SEARCHABLE_SETTINGS, type SearchHitView, type SearchSettingsTab, type SettingState, isConfigured, localScore, markLocal, settingAvailable } from "../client";
import { tabLabel, visibleTabs } from "../SettingsSheet";

/** What the window's state says about each setting's `needs`. */
export function settingState(state: AppState): SettingState {
  const folder = Boolean(state.config.folder);
  return {
    configured: isConfigured(state.config),
    folder,
    backup: folder && Boolean(state.backup?.status),
    parallel: state.parallel !== undefined,
    profiles: state.profiles !== undefined,
  };
}

interface Candidate {
  id: string;
  label: string;
  extra: string[];
  hit: (title: SearchHitView["title"]) => SearchHitView;
}

/** Matched candidates, best first (label matches before keyword ones; the table's order otherwise). */
export function matched(query: string, all: readonly Candidate[]): SearchHitView[] {
  return all
    .map((c, i) => ({ c, i, score: localScore(query, c.label, c.extra) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ c }) => c.hit(markLocal(c.label, query)));
}

/**
 * Settings rows for a typed query (§6): the registry's rows this state shows, then the harness's own fields. A row is
 * its label and its tab's name, never a value (a connection's token, a field's text).
 */
export function settingRows(t: TFunction, state: AppState, query: string): SearchHitView[] {
  if (!query.trim()) return [];
  const can = settingState(state);
  const tabs = new Set(visibleTabs(state));
  const row = (id: string, tab: SearchSettingsTab, label: string, extra: string[]): Candidate => {
    const section = tabLabel(t, state, tab);
    return {
      id,
      label,
      extra: [section, ...extra],
      hit: (title) => ({ id: `setting:${id}`, kind: "setting", title, context: [{ text: section }], hint: null, target: { kind: "setting", tab, field: id } }),
    };
  };
  const fixed = SEARCHABLE_SETTINGS.filter((s) => tabs.has(s.tab) && settingAvailable(s, can)).map((s) => row(s.id, s.tab, t(s.label), [...(s.keywords ?? [])]));
  const own = can.configured && tabs.has("harness") ? (state.settings?.fields ?? []).map((f) => row(`harness:${f.name}`, "harness", f.label, f.help ? [f.help] : [])) : [];
  return matched(query, [...fixed, ...own]);
}
