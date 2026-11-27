// The config a harness gives the context panel under `mods.context-panel`: its schema and what reads it.
import { z } from "zod";

/**
 * How much pinned text a new task gets whole, suggested to the person (context-panel spec §4.2). Absent: the core's
 * 3,000 (D0). The literals 3000 and 50_000 must stay in step with DEFAULT_PINNED_TOKENS (workspace folder-files.ts) and
 * PINNED_MAX (shell models.ts): harness-sdk can't import them (a cycle).
 */
export const contextPanelSchema = z.object({ pinnedTokens: z.number().int().min(0).max(50_000).default(3000) });
export type ContextPanelConfig = z.output<typeof contextPanelSchema>;

/** The harness's `mods["context-panel"]` config, parsed with its defaults; undefined when the harness gives none. */
export function contextPanelConfig(h: { mods?: Record<string, Record<string, unknown>> }): ContextPanelConfig | undefined {
  const raw = h.mods?.["context-panel"];
  return raw === undefined ? undefined : contextPanelSchema.parse(raw);
}
