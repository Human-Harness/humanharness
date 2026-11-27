import type { PluginsView } from "@humanharness/protocol";

/** The plugins that run, with their versions: a view that changes only a sync time or an error gives the same text. */
export function runningPlugins(view: PluginsView): string {
  return view.plugins
    .filter((p) => p.status === "on")
    .map((p) => `${p.id}@${p.version}`)
    .sort()
    .join("\n");
}
