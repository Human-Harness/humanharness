import { type LoadedHarness, hasJobs } from "@humanharness/harness-sdk";
import type { AppConfig, AppState, ConfiguredApp, TextSize } from "@humanharness/protocol";
import { type ConfigStore, cleanJobs } from "./config";
import type { FolderChangeDeps } from "./folder-change";
import { saveWithFolderChange } from "./folder-change";
import { cleanModels } from "./models";
import { type HasNotice, requireNoticeForChoice } from "./notice-policy";
import { cleanCaps } from "./parallel-config";
import type { SettingsController } from "./settings";
import { type SetupSteps, recordSetup } from "./setup-steps";
import { type ValidationContext, configProblem } from "./validate";

export interface SettingsIpcDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  /** The harness's Settings tab, or null without one. */
  settingsCtl(): SettingsController | null;
  /** Whether there are plugins (only checked for being set). */
  pluginsCtl(): unknown;
  setupCtl(): SetupSteps | null;
  /** Board mode's host, or null. */
  host(): { capsChanged(person: AppConfig["parallel"]): void } | null;
  /** Settings › Jobs as the scheduler reads them. */
  setJobSettings(jobs: AppConfig["jobs"]): void;
  validation(): ValidationContext;
  currentBase(): Promise<string | null>;
  hasNotice: HasNotice;
  folderBusy(): boolean;
  guards: FolderChangeDeps["guards"];
  interruptTasks(): Promise<void>;
  dropRuntime(): Promise<void>;
  saveConfigPatch(patch: AppConfig, before: AppConfig): Promise<void>;
  documentSessions: { closeAll(): void };
  dropDataStoresUnder(root: string): void;
  settleScopes(): Promise<void>;
  scopesChanged(): Promise<void>;
  rebasePlugins(): Promise<void>;
  validConfig(): Promise<ConfiguredApp | null>;
  jobsReady(): Promise<void>;
  backendRebase(): Promise<void>;
  backendReady(): Promise<void>;
  applyAppearance(appearance: AppConfig["appearance"]): void;
  applyTextSize(size: TextSize | undefined): void;
  jobsChanged(): void;
  refreshJobBadge(): Promise<void>;
  appState(): Promise<AppState>;
}

/** The app's config (`hh:saveConfig`) and the harness's Settings tab (harness-settings spec §4). */
export function settingsIpc(d: SettingsIpcDeps) {
  const {
    validation,
    currentBase,
    hasNotice,
    folderBusy,
    guards,
    interruptTasks,
    dropRuntime,
    saveConfigPatch,
    documentSessions,
    dropDataStoresUnder,
    settleScopes,
    scopesChanged,
    rebasePlugins,
    validConfig,
    jobsReady,
    backendRebase,
    backendReady,
    applyAppearance,
    applyTextSize,
    jobsChanged,
    refreshJobBadge,
    appState,
  } = d;
  return {
    "hh:saveConfig": async (raw: unknown) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("A config change must be an object");
      // The active profile changes only through a profile switch (profiles spec §4).
      const { profile: _profile, ...input }: AppConfig = raw as AppConfig;
      const problem = await configProblem(input, validation());
      if (problem) throw new Error(problem);
      // Spec §7: a bad entry under models is dropped, never stored.
      const cleaned: AppConfig = input.models !== undefined ? { ...input, models: cleanModels(input.models) } : input;
      // Parallel spec §7: the same for the caps; with none valid the key goes (the saved caps stay).
      const { parallel: caps, ...rest } = cleaned;
      const kept = caps !== undefined ? cleanCaps(caps) : undefined;
      const capped: AppConfig = caps === undefined ? cleaned : { ...rest, ...(kept ? { parallel: kept } : {}) };
      // Part 3: Settings › Jobs keeps only the harness's own jobs, each cleaned ({} turns every one back on); without
      // jobs the key goes (D0).
      const { jobs: jobChoices, ...noJobs } = capped;
      const declared = d.harness().jobs;
      const keptJobs = jobChoices !== undefined && declared && hasJobs(d.harness()) ? cleanJobs(jobChoices, (id) => Object.hasOwn(declared, id)) : undefined;
      const patch: AppConfig = jobChoices === undefined ? capped : { ...noJobs, ...(keptJobs ? { jobs: keptJobs } : {}) };
      const before = await d.config().load();
      const baseBefore = d.pluginsCtl() ? await currentBase() : null;
      // Spec §9: an engine is only used once its notice is accepted.
      await requireNoticeForChoice(patch.engineId, before.engineId, hasNotice);
      // A new folder: refused while a turn or a restore runs, and turns are refused until it is over; the old
      // folder's task ends and its runtime goes.
      try {
        await saveWithFolderChange(patch.folder, before.folder, { isBusy: folderBusy, guards, interrupt: interruptTasks, dropRuntime }, () =>
          saveConfigPatch(patch, before),
        );
        if (patch.folder !== undefined && patch.folder !== before.folder) {
          // The reader's watches were checked against the old folder.
          documentSessions.closeAll();
          if (before.folder) dropDataStoresUnder(before.folder);
          await settleScopes()
            .then(scopesChanged)
            .catch((err: unknown) => console.error("Could not prepare the scopes", err));
        }
      } finally {
        // Set up now, or another folder: the plugins follow the base, even when something above threw after the save.
        if (d.pluginsCtl() && (await currentBase().catch(() => null)) !== baseBefore) await rebasePlugins();
      }
      // Set up now (or in a new folder): its setup.json is on file before the window can start a task (the interview's).
      await recordSetup(d.setupCtl(), async () => (await validConfig()) !== null);
      // Set up for the first time in this process: the jobs' start runs (Decision 7). Without jobs, nothing.
      void jobsReady().catch((err: unknown) => console.error("Could not start the jobs", err));
      // The backend starts now that the app is set up, or follows a new folder. Without one, nothing (D0).
      const folderChanged = patch.folder !== undefined && patch.folder !== before.folder;
      void (folderChanged ? backendRebase() : backendReady()).catch((err: unknown) => console.error("Could not start the backend", err));
      if (patch.appearance) applyAppearance(patch.appearance);
      if (patch.textSize) applyTextSize(patch.textSize);
      // Board mode: the person's caps reach the running gate at once (parallel spec §7), under the engine's hold.
      const host = d.host();
      if (host && patch.parallel !== undefined) host.capsChanged((await d.config().load()).parallel);
      // Settings › Jobs reach the scheduler at once (its next trigger reads them), and the Jobs section and badge follow.
      d.setJobSettings((await d.config().load()).jobs);
      if (patch.jobs !== undefined) {
        jobsChanged();
        void refreshJobBadge();
      }
      return appState();
    },
    // The harness's Settings tab (harness-settings spec §4). Refusals come back as data: Electron flattens thrown errors.
    "hh:settingsGet": () => {
      const settingsCtl = d.settingsCtl();
      return settingsCtl ? settingsCtl.state() : { values: {}, pending: [] };
    },
    "hh:settingsSet": (field: unknown, value: unknown) => {
      const settingsCtl = d.settingsCtl();
      return settingsCtl ? settingsCtl.set(field, value) : { ok: false, message: "This harness has no settings" };
    },
    "hh:settingsReset": () => {
      const settingsCtl = d.settingsCtl();
      return settingsCtl ? settingsCtl.reset() : { ok: false, message: "This harness has no settings" };
    },
  };
}
