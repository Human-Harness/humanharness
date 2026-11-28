import type { LoadedHarness } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import { runCoreMods, startRunMods } from "./run-mods";

/**
 * What the harness's document kinds add to AGENTS.md on top of the base guide, which every harness has anyway. The
 * documents mod writes the guide: it alone is loaded, headless, as `run` loads it (core never imports a mod).
 */
export async function documentKindsTokens(h: LoadedHarness, kinds: Record<string, unknown>): Promise<number> {
  const coreMods = { documents: runCoreMods().documents };
  const host = await startRunMods({ harness: { ...h, mods: undefined }, folder: h.root, warn: () => {}, coreMods });
  const size = async (documentKinds: Record<string, unknown>) =>
    estimateTokens((await host.instructions({ canEdit: false, folder: h.root, documentKinds })).flat().join("\n"));
  try {
    return (await size(kinds)) - (await size({}));
  } finally {
    await host.stop();
  }
}
