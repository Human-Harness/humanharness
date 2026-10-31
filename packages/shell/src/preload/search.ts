import type { SearchAnswer, SearchClient, SearchStatus } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import type { Invoke } from "./context";

type Subscribe = (channel: PushChannel, listener: (value: unknown) => void) => () => void;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `client.search` (search spec §9): every answer is data, a rejected invoke included. `open` stays in the window. */
export function searchClient(invoke: Invoke, subscribe: Subscribe): SearchClient {
  const failed = { ok: false as const, reason: "failed" as const };
  const openers = new Set<(query?: string) => void>();
  const records = new Map<string, (key: string | number | null, scope: string) => void>();
  return {
    query: (query, filters) =>
      invoke("hh:search", query, filters ?? {}).then(
        (v) => (isObject(v) && typeof v.ok === "boolean" ? (v as SearchAnswer) : failed),
        () => failed,
      ),
    opened: (hit) =>
      invoke("hh:searchOpen", hit).then(
        (v) => ({ ok: isObject(v) && v.ok === true }),
        () => ({ ok: false }),
      ),
    onStatus: (listener) =>
      subscribe("hh:searchStatus", (v) => {
        if (isObject(v) && typeof v.state === "string" && typeof v.done === "number" && typeof v.total === "number") listener(v as unknown as SearchStatus);
      }),
    open: (query) => {
      for (const l of openers) l(typeof query === "string" ? query : undefined);
    },
    onOpen: (listener) => {
      openers.add(listener);
      return () => void openers.delete(listener);
    },
    onOpenRecord: (collection, listener) => {
      records.set(collection, listener);
      return () => {
        if (records.get(collection) === listener) records.delete(collection);
      };
    },
    openRecord: (collection, key, scope) => {
      const listener = records.get(collection);
      if (!listener) return false;
      listener(key, scope);
      return true;
    },
    handlesRecord: (collection) => records.has(collection),
  };
}
