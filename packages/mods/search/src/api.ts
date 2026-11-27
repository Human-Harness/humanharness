import type { UiCtx } from "@humanharness/mod-sdk";
import type { SearchAnswer, SearchFilters, SearchHitView, SearchStatus } from "@humanharness/protocol";

/** The mod's own ipc names (search spec §9): the palette's two calls, and the `status` push of the index's progress. */
export const SEARCH_CALLS = ["query", "opened"] as const;
export type SearchCall = (typeof SEARCH_CALLS)[number];
export const SEARCH_STATUS = "status";

/** What the palette asks of the mod's main. Every answer is data; nothing here ever reaches the engine (§8.3). */
export interface SearchApi {
  /** The results for `query`; an empty query answers the recents. The first call builds the index (D8). */
  query(query: string, filters?: SearchFilters): Promise<SearchAnswer>;
  /** The person opened `hit`: main remembers it among the recents, and shows a reference folder's file in Finder. */
  opened(hit: SearchHitView): Promise<{ ok: boolean }>;
  /** The index's progress while it builds ("Indexing… N of M"). */
  onStatus(listener: (status: SearchStatus) => void): () => void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The palette's calls over the mod's own ipc: every answer is data, a rejected call included. */
export function searchApi(ui: Pick<UiCtx, "call" | "on">): SearchApi {
  const failed = { ok: false as const, reason: "failed" as const };
  const ask = (name: SearchCall, ...args: unknown[]): Promise<unknown> => (ui.call ? Promise.resolve().then(() => ui.call!(name, args)) : Promise.reject(new Error("no call")));
  return {
    query: (query, filters) =>
      ask("query", query, filters ?? {}).then(
        (v) => (isObject(v) && typeof v.ok === "boolean" ? (v as unknown as SearchAnswer) : failed),
        () => failed,
      ),
    opened: (hit) =>
      ask("opened", hit).then(
        (v) => ({ ok: isObject(v) && v.ok === true }),
        () => ({ ok: false }),
      ),
    onStatus: (listener) =>
      ui.on?.(SEARCH_STATUS, (v) => {
        if (isObject(v) && typeof v.state === "string" && typeof v.done === "number" && typeof v.total === "number") listener(v as unknown as SearchStatus);
      }) ?? (() => {}),
  };
}
