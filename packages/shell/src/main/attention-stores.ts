import { createHmac, timingSafeEqual } from "node:crypto";
import { type AttentionOrigin, AttentionStore } from "@humanharness/workspace";

export interface AttentionStoresDeps {
  /** The Attention tag key (HMAC), kept outside the base; created only when `create`. */
  tagKey(create: boolean): Promise<Buffer | null>;
  now?: () => Date;
  log?: (message: string, err?: unknown) => void;
}

export type AttentionStores = ReturnType<typeof attentionStores>;

/**
 * One Attention store per base, shared by every source that raises items (parallel spec §9.2, Decision 10): the
 * plugins and, in board mode, the waiting tasks. One store means one write chain per attention.json. Each item is tagged
 * with an HMAC whose key stays outside the base (P5); a store lists only items whose origin a registered rule knows.
 */
export function attentionStores(d: AttentionStoresDeps) {
  const stores = new Map<string, Promise<AttentionStore | null>>();
  const rules = new Map<AttentionOrigin["kind"], (id: string) => boolean>();
  const log = (message: string, err?: unknown) => (d.log ?? console.error)(message, err);

  /** Whether an origin's items show: its kind's rule says so (no rule: never). */
  const known = (o: AttentionOrigin): boolean => {
    const rule = rules.get(o.kind);
    if (!rule) return false;
    try {
      return rule(o.id) === true;
    } catch {
      return false;
    }
  };

  async function build(base: string, create: boolean): Promise<AttentionStore | null> {
    const key = await d.tagKey(create).catch((err: unknown) => {
      log("Could not read the Attention key", err);
      return null;
    });
    if (!key) return null;
    const sign = (text: string) => createHmac("sha256", key).update(text).digest("hex");
    return new AttentionStore(base, {
      sign,
      verify: (text, tag) => {
        const a = Buffer.from(sign(text));
        const b = Buffer.from(String(tag));
        return a.length === b.length && timingSafeEqual(a, b);
      },
      known,
      ...(d.now ? { now: d.now } : {}),
      log: (m) => log(m),
    });
  }

  function fresh(base: string, create: boolean): Promise<AttentionStore | null> {
    const p = build(base, create).then((s) => {
      // No store yet: the next call tries again (with `create`, the key is made then).
      if (!s && stores.get(base) === p) stores.delete(base);
      return s;
    });
    stores.set(base, p);
    return p;
  }

  function forBase(base: string, create: boolean): Promise<AttentionStore | null> {
    const had = stores.get(base);
    if (!had) return fresh(base, create);
    // A lookup without `create` may be under way and find no key: one that may create waits for it, then makes it.
    return create ? had.then((s) => s ?? forBase(base, true)) : had;
  }

  return {
    /** Base `base`'s store, the same one every time; null while there is no key (and `create` is false) or it can't be read. */
    forBase,
    /** The rule for one origin kind (the plugins: running or crashed ones; the tasks: open lanes). The last one wins. */
    registerKnown(kind: AttentionOrigin["kind"], fn: (id: string) => boolean): void {
      rules.set(kind, fn);
    },
    known,
  };
}
