import { type HarnessSettings, SETTINGS_COLLECTION, agentSettings, sameSetting, settingsSentences, settingsValues } from "@humanharness/harness-sdk";
import type { SettingsResult, SettingsState } from "@humanharness/ui/client";
import { APP_SCOPE, type DataContext, DataError, type DataRequest, type DataStore } from "@humanharness/workspace";

/** The person, app-wide: settings belong to no scope (spec D2). */
const PERSON: DataContext = { who: "person", scope: APP_SCOPE };

export interface SettingsDeps {
  settings: HarnessSettings;
  /** The configured folder's data store; null before the app is set up. */
  store(): Promise<DataStore | null>;
  /** Writes as the person: `hh:data`'s handler, with its checks and its `Data: settings` history commit (open task's trailer). */
  write(request: DataRequest): Promise<unknown>;
  /** A task is open: its session keeps the AGENTS.md it started with. */
  taskOpen(): Promise<boolean>;
  /** TaskManager.whenNoTask: runs `fn` after the running operation, if no task is open then. */
  whenNoTask(fn: () => Promise<void>): Promise<boolean>;
  /**
   * Rewrites AGENTS.md when its text changed: `runtime.peek()`'s `refreshInstructions()`, never `get()` (which would
   * create a runtime); false when no runtime runs: the next one writes it. The controller calls it only from
   * `betweenTasks` and inside a `whenNoTask` callback, both on the task manager's queue, which also creates runtimes,
   * so a refresh never runs alongside a new runtime's first write.
   */
  refresh(): Promise<boolean>;
  /** Tells the window. */
  changed(state: SettingsState): void;
  log?(message: string, err?: unknown): void;
}

/**
 * The harness's settings in the main process (harness-settings spec §4, §5). Values live in the data store's reserved
 * `settings` collection, holding only what the person changed. A change reaches AGENTS.md between tasks, never under a
 * running session (D4): `changed` marks the settings stale and asks for a rewrite once no task is open, and the task
 * manager's `betweenTasks` applies whatever is still stale before the next session starts.
 *
 * `changed` and `betweenTasks` never reject: a data change listener may fire `changed()` without awaiting it.
 */
export class SettingsController {
  /** The values the current AGENTS.md was written with (null: none written yet, or the runtime went). */
  private applied: Record<string, unknown> | null = null;
  private stale = false;
  private writes: Promise<unknown> = Promise.resolve();
  private work: Promise<void> = Promise.resolve();

  constructor(private readonly d: SettingsDeps) {}

  /**
   * Every field's value: stored, else the default. A store that can't be read gives the defaults. It reads the file
   * and never waits for the store's write queue, so a runtime's `instructionSettings` (and its close) never blocks long.
   */
  async values(): Promise<Record<string, unknown>> {
    const store = await this.d.store().catch(() => null);
    const stored = store ? await store.get(SETTINGS_COLLECTION, undefined, PERSON).catch(() => null) : null;
    return settingsValues(this.d.settings, stored);
  }

  /** The runtime's `instructionSettings`: the sentences for AGENTS.md as they are now, remembered as what the agent was told. */
  async sentences(): Promise<string[]> {
    const values = await this.values();
    this.applied = values;
    return settingsSentences(this.d.settings, values);
  }

  async state(): Promise<SettingsState> {
    const values = await this.values();
    const applied = this.applied;
    const open = applied !== null && (await this.d.taskOpen().catch(() => false));
    const pending = open ? agentSettings(this.d.settings).filter((name) => !sameSetting(applied[name], values[name])) : [];
    return { values, pending };
  }

  /** The person changed one field (the tab saves each change at once). Back to its default, it is removed. */
  set(field: unknown, value: unknown): Promise<SettingsResult> {
    return this.serial(async () => {
      if (typeof field !== "string" || !Object.hasOwn(this.d.settings.fields, field)) return { ok: false, message: "Unknown setting" };
      const f = this.d.settings.fields[field];
      const parsed = f.schema.safeParse(value);
      if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
      const store = await this.d.store().catch(() => null);
      if (!store) return { ok: false, message: "The app is not set up yet" };
      const stored = (await store.get(SETTINGS_COLLECTION, undefined, PERSON).catch(() => null)) ?? {};
      const next: Record<string, unknown> = { ...stored };
      if (sameSetting(parsed.data, f.default)) delete next[field];
      else next[field] = parsed.data;
      if (sameSetting(next, stored)) return { ok: true, state: await this.state() };
      return this.save(Object.keys(next).length > 0 ? { op: "put", collection: SETTINGS_COLLECTION, record: next } : { op: "delete", collection: SETTINGS_COLLECTION });
    });
  }

  /** "Back to the app's defaults": the stored record goes. */
  reset(): Promise<SettingsResult> {
    return this.serial(() => this.save({ op: "delete", collection: SETTINGS_COLLECTION }));
  }

  /**
   * The stored settings changed (any writer, or a restore): the window hears it, and AGENTS.md follows once no task is
   * open (D4). A task open now keeps them stale until `betweenTasks`. Never rejects.
   */
  changed(): Promise<void> {
    this.stale = true;
    const run = (async () => {
      await this.push();
      await this.d
        .whenNoTask(() => this.apply())
        .catch((err: unknown) => this.log("Could not apply the settings", err));
    })();
    this.work = Promise.all([this.work, run]).then(() => undefined);
    return run;
  }

  /** TaskManager's `betweenTasks`: no session runs; a stale change reaches AGENTS.md now. Never rejects. */
  betweenTasks(): Promise<void> {
    return this.apply();
  }

  /** The runtime went (engine change, folder change, quit): the next one writes AGENTS.md afresh. */
  forget(): void {
    this.applied = null;
    this.stale = false;
  }

  /** Resolves once every `changed` started so far has finished (tests). */
  idle(): Promise<void> {
    return this.work;
  }

  private async apply(): Promise<void> {
    if (!this.stale) return;
    this.stale = false;
    try {
      await this.d.refresh();
    } catch (err) {
      this.stale = true;
      this.log("Could not rewrite AGENTS.md with the settings", err);
      return;
    }
    await this.push();
  }

  private async save(request: DataRequest): Promise<SettingsResult> {
    try {
      await this.d.write(request);
    } catch (err) {
      if (err instanceof DataError) return { ok: false, message: err.message };
      this.log("Could not save the settings", err);
      return { ok: false };
    }
    return { ok: true, state: await this.state() };
  }

  private async push(): Promise<void> {
    try {
      this.d.changed(await this.state());
    } catch (err) {
      this.log("Could not send the settings to the window", err);
    }
  }

  private log(message: string, err?: unknown): void {
    if (this.d.log) this.d.log(message, err);
    else console.error(message, err);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}
