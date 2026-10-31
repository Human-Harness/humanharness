import type { SearchFilters } from "@humanharness/protocol";
import { SEARCH_KINDS } from "@humanharness/protocol";
import type { InvokeChannel } from "@humanharness/protocol/channels";
import { MAX_QUERY_CHARS } from "@humanharness/search";
import type { SearchService } from "./service";

export const SEARCH_CHANNELS = ["hh:search", "hh:searchOpen"] as const satisfies readonly InvokeChannel[];
export type SearchChannel = (typeof SEARCH_CHANNELS)[number];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Only the known fields of the right kind; the rest is dropped (renderer input is untrusted). */
function cleanFilters(v: unknown): SearchFilters {
  if (!isObject(v)) return {};
  const kind = SEARCH_KINDS.find((k) => k === v.kind);
  return {
    ...(kind ? { kind } : {}),
    ...(typeof v.allScopes === "boolean" ? { allScopes: v.allScopes } : {}),
    ...(typeof v.references === "boolean" ? { references: v.references } : {}),
  };
}

/** `hh:search` and `hh:searchOpen` (§9). Every answer is data; a throw is a bug, logged, answered as a failure. */
export function searchHandlers(svc: SearchService): Record<SearchChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => Promise<unknown>, failed: unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A search call failed", err instanceof Error ? err.message : "unknown error");
        return failed;
      });
  return {
    "hh:search": (query, filters) => call(() => svc.query(typeof query === "string" ? query.slice(0, MAX_QUERY_CHARS) : "", cleanFilters(filters)), { ok: false, reason: "failed" }),
    "hh:searchOpen": (hit) => call(() => svc.opened(hit), { ok: false }),
  };
}
