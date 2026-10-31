import type { SearchAnswer, SearchClient, SearchStatus } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import type { Invoke } from "./context";

type Subscribe = (channel: PushChannel, listener: (value: unknown) => void) => () => void;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `client.search` (search spec §9): every answer is data, a rejected invoke included. `open` stays in the window. */
export function searchClient(invoke: Invoke, subscribe: Subscribe): SearchClient {
  const failed = { ok: false as const, reason: "failed" as const };
  const openers = new Set<(query?: string) => void>();
  // A stack per collection: the newest mounted listener answers; when it goes, the one under it answers again.
  const records = new Map<string, { listener: (key: string | number | null, scope: string) => void }[]>();
  const top = (collection: string) => records.get(collection)?.at(-1)?.listener;
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
      const entry = { listener };
      records.set(collection, [...(records.get(collection) ?? []), entry]);
      return () => {
        const rest = (records.get(collection) ?? []).filter((e) => e !== entry);
        if (rest.length) records.set(collection, rest);
        else records.delete(collection);
      };
    },
    openRecord: (collection, key, scope) => {
      const listener = top(collection);
      if (!listener) return false;
      listener(key, scope);
      return true;
    },
    handlesRecord: (collection) => top(collection) !== undefined,
  };
}
