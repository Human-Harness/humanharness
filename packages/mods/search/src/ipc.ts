import type { SearchFilters } from "@humanharness/protocol";
import { SEARCH_INDEX_KINDS } from "@humanharness/protocol";
import { MAX_QUERY_CHARS } from "@humanharness/search";
import type { SearchCall } from "./api";
import type { SearchService } from "./service";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Only the known fields of the right kind; the rest is dropped (renderer input is untrusted). */
function cleanFilters(v: unknown): SearchFilters {
  if (!isObject(v)) return {};
  const kind = SEARCH_INDEX_KINDS.find((k) => k === v.kind);
  return {
    ...(kind ? { kind } : {}),
    ...(typeof v.allScopes === "boolean" ? { allScopes: v.allScopes } : {}),
    ...(typeof v.references === "boolean" ? { references: v.references } : {}),
  };
}

/** The mod's `query` and `opened` calls (§9). Every answer is data; a throw is a bug, logged, answered as a failure. */
export function searchHandlers(svc: SearchService): Record<SearchCall, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => Promise<unknown>, failed: unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A search call failed", err instanceof Error ? err.message : "unknown error");
        return failed;
      });
  return {
    query: (query, filters) => call(() => svc.query(typeof query === "string" ? query.slice(0, MAX_QUERY_CHARS) : "", cleanFilters(filters)), { ok: false, reason: "failed" }),
    opened: (hit) => call(() => svc.opened(hit), { ok: false }),
  };
}
