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
});

export interface SidekickStoreDeps {
  /** The settings record in the profile's `sidekick` collection; null when none. */
  read(): Promise<SidekickRecord | null>;
  /** A data request as the person, app-wide (the person's write path: checks, `Data: sidekick` commit). */
  write(request: unknown): Promise<unknown>;
  manifest?: Pick<SidekickManifest, "default">;
}

/** Sidekick's settings (spec §8): the stored values over the defaults; only changed values are stored. */
export class SidekickStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: SidekickStoreDeps) {}

  async settings(): Promise<SidekickSettings> {
    const stored = await this.d.read().catch(() => null);
    return sidekickSettings(stored, this.d.manifest);
  }

  /** Applies `patch`, one change at a time; a bad value or a failed read or write comes back as data, never thrown. */
  set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success) return Promise.resolve({ ok: false, message: "Unknown Sidekick setting" });
    return this.serial(async () => {
      try {
        const stored = await this.d.read();
        const now = sidekickSettings(stored, this.d.manifest);
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
  return (Object.keys(a) as (keyof SidekickSettings)[]).every((k) => sameValue(a[k], b[k]));
}

/** Settings are primitives or small JSON values (`muted`), so JSON equality is enough. */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
