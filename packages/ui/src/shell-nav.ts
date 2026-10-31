/** The icon rail's entries (UI refresh spec §4.2): an entry shows only when the harness has the feature (D0). */
export type RailEntry = "home" | "tasks" | "inbox" | "jobs" | "notes" | "plugins" | "settings";

export interface RailFeatures {
  parallel: boolean;
  jobs: boolean;
  notes: boolean;
  pluginPanels: boolean;
}

export function railEntries(f: RailFeatures): RailEntry[] {
  const out: RailEntry[] = ["home", "tasks"];
  if (f.parallel) out.push("inbox");
  if (f.parallel && f.jobs) out.push("jobs");
  if (f.notes) out.push("notes");
  if (f.pluginPanels) out.push("plugins");
  out.push("settings");
  return out;
}
