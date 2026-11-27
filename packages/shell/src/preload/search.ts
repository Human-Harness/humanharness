import type { SearchClient } from "@humanharness/protocol";

/** `client.search`: what stays in the window (the palette's own calls are the `search` mod's ipc). */
export function searchClient(): SearchClient {
  const openers = new Set<(query?: string) => void>();
  // A stack per collection: the newest mounted listener answers; when it goes, the one under it answers again.
  const records = new Map<string, { listener: (key: string | number | null, scope: string) => void }[]>();
  const top = (collection: string) => records.get(collection)?.at(-1)?.listener;
  return {
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
