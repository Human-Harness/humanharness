import { randomBytes } from "node:crypto";
import {
  SIDEKICK_CAPS,
  SIDEKICK_COLLECTION,
  SIDEKICK_SETTINGS_ID,
  SIDEKICK_WAITS,
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
  muted: z.record(z.string().max(80), z.array(z.string().max(40)).max(10)).optional(),
  learnedAt: z.string().min(10).max(40).optional(),
  lastDaily: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

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
    const r = await this.change((s) => {
      already = mutedOf(s, sidekick).includes(kind);
      return already ? {} : { muted: { ...s.muted, [sidekick]: [...mutedOf(s, sidekick), kind] } };
    });
    if (!r.ok) throw new Error(r.message);
    if (already) return;
    await this.put({ id: `l-${randomBytes(4).toString("hex")}`, type: "learned", text: `Doesn't want ${kind} suggestions from ${sidekickName}.`, level: "you", kind, source: "person", updatedAt: now });
  }

  async unmute(sidekick: string, kind: string): Promise<SidekickSetResult> {
    return this.change((s) => {
      if (!Object.hasOwn(s.muted, sidekick)) return {};
      const left = mutedOf(s, sidekick).filter((k) => k !== kind);
      const { [sidekick]: _drop, ...rest } = s.muted;
      return { muted: left.length ? { ...rest, [sidekick]: left } : rest };
    });
  }

  private async read(): Promise<SidekickRecord | null> {
    return (await this.d.readAll()).find((r) => r.type === "settings" && r.id === SIDEKICK_SETTINGS_ID) ?? null;
  }

  /** The patch is made from the settings as they are when its turn comes, so quick changes (two mutes) never lose one. */
  private change(patchOf: (now: SidekickSettings) => SidekickSettingsPatch): Promise<SidekickSetResult> {
    return this.serial(async () => {
      try {
        const stored = await this.read();
        const now = sidekickSettings(stored, this.d.manifest);
        const parsed = patchSchema.safeParse(patchOf(now));
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
