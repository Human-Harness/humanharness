import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { EngineDef } from "@humanharness/engines";
import {
  type LoadedHarness,
  hasModes,
  hasSecrets,
  inputSpecs,
  interviewCollections,
  pluginsAccepted,
  profileFormSpec,
  settingsView,
} from "@humanharness/harness-sdk";
import type { AppConfig, AppState, ModeView, ModelsView } from "@humanharness/protocol";
import { syncLocations, syncStatus } from "@humanharness/workspace";
import type { ConfigStore } from "./config";
import { engineOptionExtras } from "./install-help";
import { jobsInfo } from "./jobs/jobs-host";
import { hatchesState } from "./linked-ipc";
import { materialAppState } from "./material-ipc";
import { cleanModels } from "./models";
import { engineHold, parallelInfo } from "./parallel-config";
import { type ResolvedReference, displayPath } from "./references";
import { setupStepViews } from "./setup-steps";
import { type TestHooks, isMockEngine, mockEngineText } from "./test-hooks";

/** What appState reads from the main entry. Getters for what changes after it is built. */
export interface AppStateDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  hooks: TestHooks;
  /** The plugins, or null without them. */
  pluginsCtl(): unknown;
  /** The tools host, or null without tools. */
  toolsHost(): { info(): NonNullable<AppState["tools"]> } | null;
  /** The engines this build offers. */
  offered(): EngineDef[];
  harnessLogo(): Promise<string | null>;
  engineLogo(e: EngineDef): Promise<string | null>;
  modelsView(): Promise<ModelsView>;
  referencesFor(folder: string | undefined): Promise<ResolvedReference[]>;
  /** Keeps the saved job settings the job runs read. */
  setJobSettings(jobs: AppConfig["jobs"]): void;
  /** Keeps the last app state read (it stands in after a profile change that went through). */
  setLastAppState(state: AppState): void;
}

/** The window's app state (hh:getState), read fresh from the config each time. */
export function createAppState(d: AppStateDeps): () => Promise<AppState> {
  const { hooks, offered, harnessLogo, engineLogo, modelsView, referencesFor } = d;

  /** The folder's backup status and the synced places, each with the harness's folder name inside. Paths only (backup.ts). */
  async function backupView(folder: string | undefined): Promise<NonNullable<AppState["backup"]>> {
    const harness = d.harness();
    const home = os.homedir();
    const name = path.basename(harness.folder.suggested);
    try {
      const [status, locations] = await Promise.all([folder ? syncStatus(folder, home) : Promise.resolve(null), syncLocations(home)]);
      return { status, locations: locations.map((l) => ({ ...l, suggested: path.join(l.path, name) })) };
    } catch (err) {
      console.error("Could not read the backup status", err);
      return { status: null, locations: [] };
    }
  }

  async function appState(): Promise<AppState> {
    const harness = d.harness();
    const harnessImage = await harnessLogo();
    const saved = await d.config().load();
    d.setJobSettings(saved.jobs);
    const jobs = jobsInfo(harness);
    const inputs = inputSpecs(harness.blocks);
    const interviews = interviewCollections(harness);
    const parallel = parallelInfo(harness, saved, engineHold(saved.engineId));
    const hatches = hatchesState(harness);
    const state: AppState = {
      harness: {
        id: harness.id,
        name: harness.name,
        ...(harness.tagline ? { tagline: harness.tagline } : {}),
        ...(harnessImage ? { logo: harnessImage } : {}),
        author: harness.author,
        ...(harness.donate ? { donate: harness.donate } : {}),
        version: app.getVersion(),
      },
      config: saved.models !== undefined ? { ...saved, models: cleanModels(saved.models) } : saved,
      suggestedFolder: hooks.suggestedFolder ?? path.join(os.homedir(), harness.folder.suggested),
      ...(hooks.mock ? { mock: true } : {}),
      engines: await Promise.all(
        offered().map(async (e) => {
          // Mock mode: a faked engine is shown as the test engine, with no logo, install command or plan limits.
          if (isMockEngine(hooks, e.id)) {
            return {
              id: e.id,
              ...mockEngineText(),
              status: e.status as "allowed" | "pending",
              termsUrl: e.termsUrl,
              privacyUrl: e.privacyUrl,
              reportsLimits: false,
              // Empty for Claude and Codex (D0); a mocked OpenCode keeps its cost and Terminal facts.
              ...engineOptionExtras(e),
              mock: true,
            };
          }
          const image = await engineLogo(e);
          return {
            id: e.id,
            name: e.name,
            status: e.status as "allowed" | "pending",
            provider: e.provider,
            requires: e.requires,
            dataLocation: e.dataLocation,
            trainsOnData: e.trainsOnData,
            termsUrl: e.termsUrl,
            privacyUrl: e.privacyUrl,
            reportsLimits: e.reportsLimits,
            ...(e.plansUrl ? { plansUrl: e.plansUrl } : {}),
            ...engineOptionExtras(e),
            ...(e.setup?.install ? { installCommand: e.setup.install.command, installDocsUrl: e.setup.install.docsUrl } : {}),
            ...(image ? { logo: image } : {}),
          };
        }),
      ),
      // What the screen needs of each action (never the prompt file).
      actions: Object.fromEntries(
        Object.entries(harness.actions).map(([id, a]) => [
          id,
          {
            label: a.label,
            cost: a.cost,
            ...(a.description ? { description: a.description } : {}),
            ...(a.tier ? { tier: a.tier } : {}),
            ...(a.scope ? { scope: a.scope } : {}),
            ...(a.modes ? { modes: a.modes } : {}),
            ...(a.defaultMode ? { defaultMode: a.defaultMode } : {}),
            // What the stepper shows of each phase (never its brief), and the time box's lengths (task-phases D0).
            ...(a.phases
              ? {
                  phases: a.phases.map((p) => ({
                    id: p.id,
                    label: p.label,
                    ...(p.auto ? { auto: true as const } : {}),
                    ...(p.close ? { close: true as const } : {}),
                    ...(p.modes !== undefined ? { modes: p.modes } : {}),
                  })),
                }
              : {}),
            ...(a.timeBox ? { timeBox: { options: a.timeBox.options, default: a.timeBox.default } } : {}),
            // An interview step's action is no topic (setup-steps spec §3): the setup screen and Settings start it.
            ...(Object.hasOwn(interviews, id) ? { setup: true as const } : {}),
          },
        ]),
      ),
      path: harness.path ?? [],
      ...(harness.scopes ? { scopes: harness.scopes } : {}),
      // Only a harness with input blocks sends their specs (spec D0).
      ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      // Only a harness with settings gets its tab (harness-settings D0).
      ...(harness.settings ? { settings: settingsView(harness.settings, harness.modes) } : {}),
      // Sidekick shows only for a harness that declares it (a `sidekick` key, `{}` allowed); the window draws it only with this.
      ...(harness.sidekick ? { sidekick: { id: "sidekick", name: "Sidekick", mark: "coach" } } : {}),
      // Only a harness with modes sends them (task-modes D0): what the window shows, never a brief or a hint.
      ...(hasModes(harness)
        ? {
            modes: Object.fromEntries(
              Object.entries(harness.modes).map(([id, m]): [string, ModeView] => [
                id,
                { label: m.label, ...(m.description ? { description: m.description } : {}), ...(m.minTier ? { minTier: m.minTier } : {}) },
              ]),
            ),
          }
        : {}),
      // Only a harness with setup steps sends them (setup-steps D0).
      ...(harness.setup ? { setup: setupStepViews(harness) } : {}),
      // Only a harness with profiles sends them (profiles D4): what to call one, and its form.
      ...(harness.profiles ? { profiles: { label: harness.profiles.label, form: profileFormSpec(harness) } } : {}),
      // Only a harness with material sends what it takes (material D0).
      ...materialAppState(harness),
      // Only a harness that takes plugins (or dev folders) sends this: the Plugins tab and the inbox (plugins D0).
      ...(d.pluginsCtl() ? { plugins: { local: pluginsAccepted(harness) && (harness.plugins?.local ?? false) } } : {}),
      // Only a harness that declares `parallel` sends this: caps, the task inbox (parallel D7).
      ...(parallel ? { parallel } : {}),
      // Only a harness that declares jobs sends them: the Jobs tab and the inbox's Jobs section (part 3 D0).
      ...(jobs ? { jobs } : {}),
      // The reader's template check (document-reader spec §4.3); absent without kinds (D0).
      ...(harness.documents ? { documents: { kinds: harness.documents.kinds } } : {}),
      // Documents can be reviewed only when the agent may edit the folder (review spec D0).
      ...(harness.permissions.edit === "folder" ? { review: true as const } : {}),
      // Only a harness that declares a hatch sends this: Scope settings (hatches D0).
      ...(hatches ? { hatches } : {}),
      // Only a harness that declares secrets sends this: Settings › Connections (tools spec §9, D0).
      ...(hasSecrets(harness) ? { connections: { count: harness.secrets!.length } } : {}),
      // Only a harness that declares tools sends this: their ids and why they are off, if they are (tools spec §5, D0).
      ...(d.toolsHost() ? { tools: d.toolsHost()!.info() } : {}),
      references: (await referencesFor(saved.folder)).map((r) => ({ id: r.id, label: r.label, path: displayPath(r.path, os.homedir()) })),
      models: await modelsView(),
      backup: await backupView(saved.folder),
    };
    d.setLastAppState(state);
    return state;
  }

  return appState;
}
