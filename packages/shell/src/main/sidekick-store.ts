import { createHash, randomBytes } from "node:crypto";
import {
  DEFAULT_SIDEKICK,
  SIDEKICK_CAPS,
  SIDEKICK_COLLECTION,
  SIDEKICK_MUTED_MAX,
  SIDEKICK_SETTINGS_ID,
  SIDEKICK_WAITS,
  type SidekickDef,
  type SidekickManifest,
  type SidekickRecord,
  type SidekickSettings,
  sidekickSettings,
  z,
} from "@humanharness/harness-sdk";

export type SidekickSettingsPatch = Partial<SidekickSettings>;
export type SidekickSetResult = { ok: true; settings: SidekickSettings } | { ok: false; message: string };

const oneOf = <T extends readonly (string | number)[]>(values: T) => z.custom<T[number]>((v) => (values as readonly unknown[]).includes(v));
const patchSchema = z.strictObject({
  on: z.boolean().optional(),
  preSend: z.boolean().optional(),
  wait: oneOf(SIDEKICK_WAITS).optional(),
  cap: oneOf(SIDEKICK_CAPS).optional(),
  introSeen: z.boolean().optional(),
  afterReply: z.boolean().optional(),
  headsUps: z.boolean().optional(),
  presetsOffered: z.boolean().optional(),
  muted: z.record(z.string().max(80), z.array(z.string().max(40)).max(SIDEKICK_MUTED_MAX)).optional(),
  learnedAt: z.string().min(10).max(40).optional(),
  lastDaily: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * How many sidekicks a person may have: a new one past this is refused (checked in the record queue, so quick saves
 * and adoptions never pass it together), and a reorder names at most this many ids (every order stays below 999).
 */
export const SIDEKICK_MAX = 20;

/** A sidekick to save: new without `id`, else an edit of that one (its order kept unless given). */
export type SidekickInput = Omit<SidekickDef, "id" | "order"> & { id?: string; order?: number };
/** A sidekick in a scope (spec §2a.4). */
export interface SidekickScope {
  on: boolean;
  purposeText?: string;
  places?: string[];
}

/**
 * Ids a new sidekick never gets: `learn`, `route`, `daily`, `place` and `import` are those one-off turns' folders (`workDir(base, "learn")`), `sidekick` is
 * the default one's, whose folder, muted kinds and scope records a new sidekick must not inherit, and `settings` is
 * the settings record's (all record types share one id space, and a put replaces by id).
 */
const RESERVED_IDS: ReadonlySet<string> = new Set(["learn", "route", "daily", "place", "import", DEFAULT_SIDEKICK.id, SIDEKICK_SETTINGS_ID]);

/** A name's id: accents dropped, `-` between words; `k-` before it when it would look like a scope (`s-`) or learned (`l-`) id. */
const slug = (name: string) => {
  const base =
    name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") ||
    DEFAULT_SIDEKICK.id;
  return /^[sl]-/.test(base) ? `k-${base}` : base;
};

const toDef = (r: SidekickRecord): SidekickDef => ({
  id: r.id,
  name: r.name!,
  mark: r.mark!,
  personality: r.personality ?? "",
  purposes: r.purposes!,
  order: r.order!,
  ...(r.tier ? { tier: r.tier } : {}),
  ...(typeof r.source === "object" ? { source: r.source } : {}),
  ...(r.preset ? { preset: r.preset } : {}),
  ...(r.defaultOn !== undefined ? { defaultOn: r.defaultOn } : {}),
});

const toRecord = (d: SidekickDef): SidekickRecord => ({ ...d, type: "sidekick" });

export interface SidekickStoreDeps {
  /** Every record of the profile's `sidekick` collection (settings, learned items, sidekicks, scope records). */
  readAll(): Promise<SidekickRecord[]>;
  /** A data request as the person, app-wide (the person's write path: checks, `Data: sidekick` commit). */
  write(request: unknown): Promise<unknown>;
  manifest?: Pick<SidekickManifest, "default">;
}

/** Sidekick's settings (spec §8): the stored values over the defaults; only changed values are stored. */
export class SidekickStore {
  private writes: Promise<unknown> = Promise.resolve();
  /** Sidekick and scope record changes, one at a time (two quick saves never both write the default or the same id). */
  private recordWrites: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: SidekickStoreDeps) {}

  async settings(): Promise<SidekickSettings> {
    const stored = await this.read().catch(() => null);
    return sidekickSettings(stored, this.d.manifest);
  }

  /** Every record of the collection; [] when it can't be read. */
  async all(): Promise<SidekickRecord[]> {
    return this.d.readAll().catch(() => []);
  }

  async put(record: SidekickRecord): Promise<void> {
    await this.d.write({ op: "put", collection: SIDEKICK_COLLECTION, record });
  }

  async remove(id: string): Promise<void> {
    await this.d.write({ op: "delete", collection: SIDEKICK_COLLECTION, key: id });
  }

  /** Applies `patch`, one change at a time; a bad value or a failed read or write comes back as data, never thrown. */
  set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    return this.change(() => patch);
  }

  /**
   * "Don't flag …" (spec §6.3): muted at once for that sidekick, plus a learned item marked the person's (once per
   * kind). Throws when the setting can't be written (the learned item is then not written either).
   */
  async mute(sidekick: string, sidekickName: string, kind: string, now: string): Promise<void> {
    let already = false;
    const r = await this.change(async (s) => {
      // A late mute for a removed sidekick would leave muted kinds a later one with its id inherits.
      if (!(await this.sidekicks()).some((k) => k.id === sidekick)) throw new Error(`No sidekick "${sidekick}"`);
      already = mutedOf(s, sidekick).includes(kind);
      return already ? {} : { muted: { ...s.muted, [sidekick]: [...mutedOf(s, sidekick), kind] } };
    });
    if (!r.ok) throw new Error(r.message);
    if (already) return;
    const text = `Doesn't want ${kind} suggestions from ${sidekickName}.`;
    // Muted again after an unmute: the item the person kept from the first time is enough.
    if ((await this.all()).some((r) => r.type === "learned" && r.source === "person" && r.kind === kind && r.text === text)) return;
    await this.put({ id: `l-${randomBytes(4).toString("hex")}`, type: "learned", text, level: "you", kind, source: "person", updatedAt: now });
  }

  async unmute(sidekick: string, kind: string): Promise<SidekickSetResult> {
    return this.change((s) => {
      if (!Object.hasOwn(s.muted, sidekick)) return {};
      const left = mutedOf(s, sidekick).filter((k) => k !== kind);
      const { [sidekick]: _drop, ...rest } = s.muted;
      return { muted: left.length ? { ...rest, [sidekick]: left } : rest };
    });
  }

  /** The person's sidekicks by order; the implicit default when none is written (Decision 2, D0). */
  async sidekicks(): Promise<SidekickDef[]> {
    return sidekicksOf(await this.all());
  }

  /**
   * New when `s.id` is absent (a slug of its name, `-2`, `-3` on clashes, last in order; refused past SIDEKICK_MAX);
   * else replaces that one's fields.
   */
  saveSidekick(s: SidekickInput): Promise<SidekickDef> {
    return this.serialRecords(async () => {
      // Checked before anything is written: a refused one doesn't write the implicit default either.
      if (s.id === undefined && sidekicksOf(await this.d.readAll()).length >= SIDEKICK_MAX) throw new Error(`At most ${SIDEKICK_MAX} sidekicks`);
      const all = await this.materialize();
      const old = s.id !== undefined ? all.find((k) => k.id === s.id) : undefined;
      if (s.id !== undefined && !old) throw new Error(`No sidekick "${s.id}"`);
      let id = old?.id;
      if (!id) {
        const base = slug(s.name);
        // Every record's id, not only the sidekicks': settings, scope and learned records share the id space.
        const records = await this.d.readAll();
        const taken = (x: string) => RESERVED_IDS.has(x) || records.some((r) => r.id === x) || all.some((k) => k.id === x);
        id = base;
        for (let n = 2; taken(id); n++) id = `${base}-${n}`;
        // Muted kinds left by an earlier sidekick with this id (a mute that landed after it was removed).
        const pruned = await this.change((st) => {
          if (!Object.hasOwn(st.muted, id!)) return {};
          const { [id!]: _drop, ...rest } = st.muted;
          return { muted: rest };
        });
        if (!pruned.ok) throw new Error(pruned.message);
      }
      const { id: _id, order: _order, ...fields } = s;
      const def: SidekickDef = { ...fields, id, order: s.order ?? old?.order ?? Math.max(-1, ...all.map((k) => k.order)) + 1 };
      await this.put(toRecord(def));
      return def;
    });
  }

  /** Orders the sidekicks as `ids` (spec §2a.2: the person's order breaks ties); ones not named keep their turn after. */
  reorder(ids: readonly string[]): Promise<void> {
    return this.serialRecords(async () => {
      const all = await this.materialize();
      const named = [...new Set(ids)].map((id) => all.find((k) => k.id === id)).filter((k): k is SidekickDef => !!k);
      const ordered = [...named, ...all.filter((k) => !named.includes(k))];
      for (const [order, k] of ordered.entries()) if (k.order !== order) await this.put(toRecord({ ...k, order }));
    });
  }

  /** Deletes a sidekick, its scope records and its muted kinds; the last one stays. */
  async removeSidekick(id: string): Promise<void> {
    await this.serialRecords(async () => {
      // Refused before anything is written: the implicit default alone is "the last one".
      const records = await this.d.readAll();
      const all = sidekicksOf(records);
      if (!all.some((k) => k.id === id)) throw new Error(`No sidekick "${id}"`);
      if (all.length <= 1) throw new Error("Keep at least one sidekick");
      await this.remove(id);
      for (const r of records) if (r.type === "scope" && r.sidekick === id) await this.remove(r.id);
    });
    const r = await this.change((s) => {
      if (!Object.hasOwn(s.muted, id)) return {};
      const { [id]: _drop, ...rest } = s.muted;
      return { muted: rest };
    });
    if (!r.ok) throw new Error(r.message);
  }

  /** A sidekick in a scope (spec §2a.4): its scope record, else on per its `defaultOn` (absent = on). */
  async scopeFor(scope: string, sidekick: string): Promise<SidekickScope> {
    const all = await this.all();
    const r = all.find((x) => x.type === "scope" && x.scope === scope && x.sidekick === sidekick);
    if (r) return { on: r.on!, ...(r.purposeText ? { purposeText: r.purposeText } : {}), ...(r.places ? { places: r.places } : {}) };
    return { on: sidekicksOf(all).find((k) => k.id === sidekick)?.defaultOn ?? true };
  }

  /** Writes the scope record `s-<scope>-<sidekick>` (Decision 1), replacing that pair's earlier one. */
  setScope(scope: string, sidekick: string, v: SidekickScope): Promise<void> {
    return this.serialRecords(async () => {
      if (!sidekicksOf(await this.d.readAll()).some((k) => k.id === sidekick)) throw new Error(`No sidekick "${sidekick}"`);
      await this.materialize();
      const all = await this.d.readAll();
      const old = all.find((x) => x.type === "scope" && x.scope === scope && x.sidekick === sidekick);
      await this.put({ id: old?.id ?? scopeId(scope, sidekick, all), type: "scope", scope, sidekick, ...v });
    });
  }

  /** Writes the implicit default when no sidekick record exists yet (Decision 2: the first change writes it). */
  private async materialize(): Promise<SidekickDef[]> {
    const all = await this.d.readAll();
    if (all.some((r) => r.type === "sidekick")) return sidekicksOf(all);
    await this.put(toRecord(DEFAULT_SIDEKICK));
    return [DEFAULT_SIDEKICK];
  }

  private async read(): Promise<SidekickRecord | null> {
    return (await this.d.readAll()).find((r) => r.type === "settings" && r.id === SIDEKICK_SETTINGS_ID) ?? null;
  }

  /** The patch is made from the settings as they are when its turn comes, so quick changes (two mutes) never lose one. */
  private change(patchOf: (now: SidekickSettings) => SidekickSettingsPatch | Promise<SidekickSettingsPatch>): Promise<SidekickSetResult> {
    return this.serial(async () => {
      try {
        const stored = await this.read();
        const now = sidekickSettings(stored, this.d.manifest);
        const parsed = patchSchema.safeParse(await patchOf(now));
        if (!parsed.success) return { ok: false, message: "Unknown Sidekick setting" };
        const next: SidekickSettings = { ...now, ...stripUndefined(parsed.data) };
        if (sameSettings(now, next)) return { ok: true, settings: next };
        const defaults = sidekickSettings(null, this.d.manifest);
        const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => !sameValue(defaults[k as keyof SidekickSettings], v)));
        if (Object.keys(changed).length > 0) {
          await this.d.write({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: SIDEKICK_SETTINGS_ID, type: "settings", ...changed } });
        } else if (stored) {
          await this.d.write({ op: "delete", collection: SIDEKICK_COLLECTION, key: SIDEKICK_SETTINGS_ID });
        }
        return { ok: true, settings: next };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }

  private serialRecords<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.recordWrites.then(fn, fn);
    this.recordWrites = run.catch(() => undefined);
    return run;
  }
}

function sidekicksOf(all: SidekickRecord[]): SidekickDef[] {
  const written = all.filter((r) => r.type === "sidekick").map(toDef);
  return written.length ? written.sort((a, b) => a.order - b.order) : [DEFAULT_SIDEKICK];
}

/** `s-<scope>-<sidekick>`; a hashed id when that is too long or already another pair's (`a-b`+`c` vs `a`+`b-c`). */
function scopeId(scope: string, sidekick: string, all: SidekickRecord[]): string {
  const plain = `s-${scope}-${sidekick}`;
  if (plain.length <= 80 && !all.some((r) => r.id === plain)) return plain;
  return `s-${createHash("sha256").update(`${scope}\n${sidekick}`).digest("hex").slice(0, 32)}`;
}

function sameSettings(a: SidekickSettings, b: SidekickSettings): boolean {
  // Both sides' keys: the optional ones (learnedAt, lastDaily) are absent until set.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SidekickSettings>;
  return [...keys].every((k) => sameValue(a[k], b[k]));
}

/** Settings are primitives or small JSON values (`muted`), so JSON equality is enough. */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const mutedOf = (s: SidekickSettings, sidekick: string): string[] => (Object.hasOwn(s.muted, sidekick) ? s.muted[sidekick] : []);
