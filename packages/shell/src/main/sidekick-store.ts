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
  constructor(private readonly d: SidekickStoreDeps) {}

  async settings(): Promise<SidekickSettings> {
    const stored = await this.d.read().catch(() => null);
    return sidekickSettings(stored, this.d.manifest);
  }

  /** Applies `patch`; a bad value or a failed write comes back as data, never thrown. */
  async set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success) return { ok: false, message: "Unknown Sidekick setting" };
    try {
      const stored = await this.d.read().catch(() => null);
      const next: SidekickSettings = { ...sidekickSettings(stored, this.d.manifest), ...stripUndefined(parsed.data) };
      const defaults = sidekickSettings(null, this.d.manifest);
      const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => defaults[k as keyof SidekickSettings] !== v));
      if (Object.keys(changed).length > 0) {
        await this.d.write({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: SIDEKICK_SETTINGS_ID, type: "settings", ...changed } });
      } else if (stored) {
        await this.d.write({ op: "delete", collection: SIDEKICK_COLLECTION, key: SIDEKICK_SETTINGS_ID });
      }
      return { ok: true, settings: next };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
