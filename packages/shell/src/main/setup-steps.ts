import { type ActionCost, type Collection, type HarnessSettings, type HarnessSetupStep, setupFormSpec, type z } from "@humanharness/harness-sdk";
import type { InputIssue, SettingsResult, SetupStepResult, SetupStepView, SetupStepsState } from "@humanharness/ui/client";
import { APP_SCOPE, type DataContext, DataError, type DataRequest, type DataStore } from "@humanharness/workspace";
import { DataUnavailable } from "./data-requests";
import { type SetupFile, SetupStore, type StepMark, emptySetup, setupState } from "./setup-store";

/** The person, app-wide: setup steps belong to no scope (setup-steps spec §3). */
const PERSON: DataContext = { who: "person", scope: APP_SCOPE };

export interface SetupStepsDeps {
  /** The manifest's `setup`. */
  steps: readonly HarnessSetupStep[];
  /** The manifest's collections. */
  data: Record<string, Collection>;
  settings?: HarnessSettings;
  /** The folder `.harness/` is under (`baseOf`, the profile's folder from plan 7); null before the app is set up. */
  base(): Promise<string | null>;
  /** That folder's data store. */
  store(): Promise<DataStore | null>;
  /** Writes as the person, app-wide: `hh:data`'s handler, with its checks, its refusals and its `Data:` commit. */
  write(request: DataRequest): Promise<unknown>;
  /** SettingsController.set: one field, with its rules. Absent without settings. */
  setSetting?(field: string, value: unknown): Promise<SettingsResult>;
  /** SettingsController.values. */
  settingValues?(): Promise<Record<string, unknown>>;
  /** The open task's action, if a task is open. */
  openAction(): Promise<string | undefined>;
  /** The folder ran tasks before (`tasks.json` exists). */
  ranBefore(base: string): Promise<boolean>;
  quitting(): boolean;
  /** Tells the window. */
  changed(state: SetupStepsState): void;
  now?(): Date;
  log?(message: string, err?: unknown): void;
}

const invalid = (errors: InputIssue[]): SetupStepResult => ({ ok: false, reason: "invalid", errors });
/** Also when `setup.json` can't be read: saving would lose every recorded step. */
const NOT_READY: SetupStepResult = { ok: false, reason: "not-ready" };
const isRecord =(v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The harness's setup steps in the main process (setup-steps spec §3–§5). State lives in `.harness/setup.json`; what a
 * step produces lives in data or settings (D3). Every change runs one at a time and tells the window.
 */
export class SetupSteps {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly ids: string[];

  constructor(private readonly d: SetupStepsDeps) {
    this.ids = d.steps.map((s) => s.id);
  }

  /** In line with the changes: a read can write the backfill (`read`), which must not land over a new mark. */
  state(): Promise<SetupStepsState> {
    return this.serial(() => this.current());
  }

  /** A form step's current values: the record's fields it asks for, or the settings' values. {} for anything else. */
  async values(id: unknown): Promise<Record<string, unknown>> {
    const step = this.find(id);
    if (step?.kind !== "form") return {};
    if (step.settings) {
      const all = (await this.d.settingValues?.().catch(() => null)) ?? {};
      return Object.fromEntries(step.settings.filter((n) => Object.hasOwn(all, n)).map((n) => [n, all[n]]));
    }
    const store = await this.d.store().catch(() => null);
    const record = store && step.collection ? await store.get(step.collection, undefined, PERSON).catch(() => null) : null;
    return record ? Object.fromEntries((step.fields ?? []).filter((f) => Object.hasOwn(record, f)).map((f) => [f, record[f]])) : {};
  }

  /** A form's Next (spec §3 `form`): the same checks as any write, then the step is done. */
  submit(id: unknown, value: unknown): Promise<SetupStepResult> {
    return this.serial(async () => {
      const step = this.find(id);
      if (step?.kind !== "form") return { ok: false, reason: "unknown" };
      const base = await this.ready();
      if (!base) return { ok: false, reason: "not-ready" };
      if (!isRecord(value)) return invalid([{ path: "", message: "Expected the form's fields" }]);
      // The step's state couldn't be kept: don't write its data either.
      if (!(await this.read(base))) return NOT_READY;
      const errors = step.settings ? await this.saveSettings(step.settings, value) : await this.saveRecord(step, value);
      if (errors.length > 0) return invalid(errors);
      return this.mark(base, step.id, "done");
    });
  }

  /** An interview's or a component's end. An interview needs its task closed and a valid record (spec §3). */
  complete(id: unknown): Promise<SetupStepResult> {
    return this.serial(async () => {
      const step = this.find(id);
      if (!step || step.kind === "form") return { ok: false, reason: "unknown" };
      const base = await this.ready();
      if (!base) return { ok: false, reason: "not-ready" };
      if (step.kind === "interview") {
        if ((await this.d.openAction().catch(() => undefined)) === step.action) return { ok: false, reason: "open" };
        if (!(await this.hasRecord(step.writes))) return { ok: false, reason: "incomplete" };
      }
      return this.mark(base, step.id, "done");
    });
  }

  /** Remembered, offered again from Settings (D5). A done step stays done. */
  skip(id: unknown): Promise<SetupStepResult> {
    return this.serial(async () => {
      const step = this.find(id);
      if (!step) return { ok: false, reason: "unknown" };
      if (step.required) return { ok: false, reason: "required" };
      const base = await this.ready();
      if (!base) return { ok: false, reason: "not-ready" };
      const file = await this.read(base);
      if (!file) return NOT_READY;
      if (Object.hasOwn(file.steps, step.id) && file.steps[step.id].state === "done") return { ok: true, state: setupState(file, this.d.steps) };
      return this.mark(base, step.id, "skipped");
    });
  }

  /** The setup screen reached "All set": the first time is kept, and every step now counts as seen. */
  finish(): Promise<SetupStepsState> {
    return this.serial(() => this.see(true));
  }

  /** Settings showed the list: steps added by an update count from now on (spec §8 Q3). */
  acknowledge(): Promise<SetupStepsState> {
    return this.serial(() => this.see(false));
  }

  private async see(finishing: boolean): Promise<SetupStepsState> {
    const base = await this.ready();
    if (!base) return this.current();
    const file = await this.read(base);
    if (!file) return setupState(emptySetup(), this.d.steps);
    const known = file.known ?? [];
    if ((!finishing || file.finishedAt) && this.ids.every((id) => known.includes(id))) return setupState(file, this.d.steps);
    const next: SetupFile = { ...file, ...(file.finishedAt || !finishing ? {} : { finishedAt: this.nowIso() }), known: [...this.ids] };
    await this.save(base, next);
    return this.push(next);
  }

  private find(id: unknown): HarnessSetupStep | undefined {
    return typeof id === "string" ? this.d.steps.find((s) => s.id === id) : undefined;
  }

  private async ready(): Promise<string | null> {
    if (this.d.quitting()) return null;
    return this.d.base().catch(() => null);
  }

  /** What the window sees: an unreadable file reads as empty (nothing is saved over it). Not serialized: callers are. */
  private async current(): Promise<SetupStepsState> {
    const base = await this.d.base().catch(() => null);
    return setupState((base ? await this.read(base) : null) ?? emptySetup(), this.d.steps);
  }

  /**
   * The folder's file; a folder with no file that ran tasks before counts as set up before these steps existed.
   * Null when the file is there but can't be read (EACCES, EIO, a failed set-aside): no write may save over it.
   */
  private async read(base: string): Promise<SetupFile | null> {
    let stored: SetupFile | null;
    try {
      stored = await new SetupStore(base, this.ids).load();
    } catch (err) {
      this.log("Could not read setup.json", err);
      return null;
    }
    if (stored) return stored;
    if (!(await this.d.ranBefore(base).catch(() => false))) return emptySetup();
    const file: SetupFile = { ...emptySetup(), finishedAt: this.nowIso(), known: [] };
    await this.save(base, file).catch((err: unknown) => this.log("Could not write setup.json", err));
    return file;
  }

  private async mark(base: string, id: string, state: StepMark): Promise<SetupStepResult> {
    const file = await this.read(base);
    if (!file) return NOT_READY;
    const next: SetupFile = { ...file, steps: { ...file.steps, [id]: { state, at: this.nowIso() } } };
    await this.save(base, next);
    return { ok: true, state: this.push(next) };
  }

  private save(base: string, file: SetupFile): Promise<void> {
    return new SetupStore(base, this.ids).save(file);
  }

  private push(file: SetupFile): SetupStepsState {
    const state = setupState(file, this.d.steps);
    try {
      this.d.changed(state);
    } catch (err) {
      this.log("Could not send the setup steps to the window", err);
    }
    return state;
  }

  private async hasRecord(collection: string): Promise<boolean> {
    const store = await this.d.store().catch(() => null);
    if (!store) return false;
    return store.readAll(collection, APP_SCOPE).then(
      (r) => r.records.length > 0,
      () => false,
    );
  }

  /** Each settings field through the settings controller; the first refusal stops the rest. */
  private async saveSettings(names: string[], value: Record<string, unknown>): Promise<InputIssue[]> {
    if (!this.d.setSetting) return [{ path: "", message: "This harness has no settings" }];
    for (const name of names) {
      if (!Object.hasOwn(value, name)) continue;
      const r = await this.d.setSetting(name, value[name]);
      if (!r.ok) return [{ path: name, message: r.message ?? "That didn't save" }];
    }
    return [];
  }

  /** The step's fields, each checked against its schema, merged into the record and written as the person with `put`. */
  private async saveRecord(step: Extract<HarnessSetupStep, { kind: "form" }>, value: Record<string, unknown>): Promise<InputIssue[]> {
    const collection = step.collection!;
    const shape = this.d.data[collection].schema.shape as Record<string, z.ZodType>;
    const picked: Record<string, unknown> = {};
    const errors: InputIssue[] = [];
    for (const f of step.fields ?? []) {
      if (!Object.hasOwn(value, f) || !Object.hasOwn(shape, f)) continue;
      const parsed = shape[f].safeParse(value[f]);
      if (parsed.success) picked[f] = parsed.data;
      else errors.push({ path: f, message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    if (errors.length > 0) return errors;
    const store = await this.d.store().catch(() => null);
    const before = (store ? await store.get(collection, undefined, PERSON).catch(() => null) : null) ?? {};
    try {
      await this.d.write({ op: "put", collection, record: { ...before, ...picked } });
      return [];
    } catch (err) {
      if (err instanceof DataError || err instanceof DataUnavailable) return [{ path: "", message: err.message }];
      this.log("Could not save the setup form", err);
      return [{ path: "", message: "Something went wrong with the data" }];
    }
  }

  private nowIso(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
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

/** What the window draws of each setup step (spec §3), in order: a form's fields, an interview's action and cost, a component's name. */
export function setupStepViews(h: {
  setup?: readonly HarnessSetupStep[];
  actions: Record<string, { cost: ActionCost }>;
  data: Record<string, Collection>;
  settings?: HarnessSettings;
}): SetupStepView[] {
  return (h.setup ?? []).map((s): SetupStepView => {
    const base = { id: s.id, kind: s.kind, label: s.label, required: s.required, ...(s.description ? { description: s.description } : {}) };
    if (s.kind === "form") return { ...base, form: setupFormSpec(s, h) };
    // The manifest guarantees an interview's action exists.
    if (s.kind === "interview") return { ...base, action: s.action, cost: h.actions[s.action].cost };
    return { ...base, component: s.component };
  });
}
