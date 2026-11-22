import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelProfile } from "@humanharness/engines";
import { DEFAULT_LANGUAGE, type LoadedHarness, hasExpects, hasModes, hasPre, inputBlocks, interviewCollections, resolveInHarness } from "@humanharness/harness-sdk";
import { type PickInput, modelPolicy } from "@humanharness/policies";
import type { ConfiguredApp } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import type { EnginePreset, HarnessRuntime } from "@humanharness/runtime";
import {
  APP_SCOPE,
  type DataStore,
  type History,
  buildDataContextParts,
  isScopeId,
  notesPrefix,
  readNotes,
  writeNote,
} from "@humanharness/workspace";
import { type MaterialStore, groundingMode, materialSection } from "@humanharness/material/light";
import { notePath, saveAppChange } from "./app-change";
import type { BoardHost } from "./board-host";
import { ChatLog } from "./chat-log";
import type { ConfigStore } from "./config";
import type { ContextService } from "./context";
import { saveAnswerRecords } from "./data-requests";
import type { EngineHost } from "./engine-config/engine-host";
import type { Turns } from "./gated-turns";
import type { JobsHost } from "./jobs/jobs-host";
import { cleanModels, manifestTier, nearestTier } from "./models";
import type { ModHost } from "./mods/host";
import { toTurnEnd } from "./mods/wiring";
import type { PluginsController } from "./plugins";
import type { LinkedInstructions, ScopeAccess } from "./scope-access";
import type { SettingsController } from "./settings";
import type { SharedConfigStore } from "./shared-config";
import type { PhaseMoved, TaskDeps, TaskManager, TurnEnd } from "./task-manager";
import { TaskStore, emptyTasks } from "./task-store";
import type { ToolsHost } from "./tools/tools-host";
import type { TurnController, TurnDeps, memoise } from "./turn-controller";
import { UsageLog, compactionRecord, policyMeta, profileMeta, subagentRecord, usageRecord } from "./usage-log";

/** The linked-folder parts, or null without them. */
type LinkedParts = { access: ScopeAccess; instructions: LinkedInstructions } | null;

/** What the TurnController's deps read from the main entry. Getters for what changes after they are built. */
export interface TurnDepsDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  shared(): SharedConfigStore;
  runtime: ReturnType<typeof memoise<HarnessRuntime>>;
  /** Throws why a turn can't start now. */
  checkTurn(): Promise<void>;
  turnChatLog(chat: string | undefined): ReturnType<TurnDeps["chatLog"]>;
  stateBlocks: TurnDeps["stateBlocks"];
  emit: TurnDeps["emit"];
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  engineHost(): EngineHost | undefined;
  linked(): LinkedParts;
}

/** The TurnController's deps; board mode's lanes reuse them with their own slot, chat and window routing. */
export function createTurnDeps(d: TurnDepsDeps): TurnDeps {
  const { runtime, checkTurn, turnChatLog, stateBlocks, emit, validConfig, baseOf } = d;
  const turnDeps: TurnDeps = {
    ensureRuntime: async () => {
      await checkTurn();
      return runtime.get();
    },
    chatLog: (chat) => turnChatLog(chat),
    stateBlocks,
    inputBlocks: () => new Set(Object.keys(inputBlocks(d.harness().blocks))),
    emit,
    recordUsage: async (entry, meta, firstLimits, subagents) => {
      const c = await validConfig();
      const record = c ? usageRecord(entry, c.engineId, meta, firstLimits) : null;
      if (c && record) await new UsageLog(baseOf(c)).append(record);
      // The subagents' tokens are their own lines, after the turn's (subagent plan D4).
      if (c) for (const sub of subagents) await new UsageLog(baseOf(c)).append(subagentRecord(sub, c.engineId, meta, entry.at));
    },
    engineId: async () => (await d.config().load()).engineId,
    sessionExpired: async (engineId) => {
      await d.shared().update(engineId, { verifiedAt: null });
    },
    // A preset's agents get the subagent model of the turn's profile (subagent policy D2). Undefined without enginePresets (D0).
    get presetFor() {
      const host = d.engineHost();
      return host ? (engine: EnginePreset, profile: ModelProfile | undefined) => host.withSubagentModel(engine, profile) : undefined;
    },
    // The turn's own task scope's linked folders, checked each turn (hatches L5). A getter: undefined without them (D0).
    get scopeAccess() {
      const linked = d.linked();
      return linked ? (scope: string) => linked.access.access(scope) : undefined;
    },
  };
  return turnDeps;
}

/** What the TaskManager's deps read from the main entry. Getters for what changes after they are built. */
export interface TaskDepsDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  runtime: ReturnType<typeof memoise<HarnessRuntime>>;
  hooks: { minuteMs?: number };
  /** Today's turns (plain mode). */
  turns: TurnController;
  /** `single` mode's gated turns, or null. */
  single(): { turns: Turns } | null;
  /** The note `single` mode's next history save commits alone. */
  singleNote(): string | undefined;
  setSingleNote(note: string | undefined): void;
  jobsHost(): JobsHost | null;
  modHost(): ModHost | null;
  pluginsCtl(): PluginsController | null;
  settingsCtl(): SettingsController | null;
  toolsHost(): ToolsHost | null;
  /** Board mode's host, or null. */
  host(): BoardHost | null;
  /** The open task(s): a TaskManager, or board mode's TaskBoard. */
  tasks(): Pick<TaskManager, "runningTask">;
  contextSvc(): ContextService;
  engineHost(): EngineHost | undefined;
  linked(): LinkedParts;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  taskStoreOptions(): { modes?: string[]; phases?: Record<string, string[]> };
  scoped(): boolean;
  activeScope(id: string): Promise<boolean>;
  dataStoreFor(base: string): DataStore;
  materialStore(base: string, scope: string): MaterialStore;
  sendContext(task: string): Promise<void>;
  closeRuntime(): Promise<void>;
  readPhaseBrief(action: string, phase: string): Promise<string>;
  sendToWindow(channel: PushChannel, value: unknown): void;
  currentHistory(): Promise<History | null>;
  emit: TaskDeps["emit"];
  pickProfile(policyId: string | undefined, input: Omit<PickInput, "offer">): Promise<ModelProfile>;
  supportedEffort(p: ModelProfile): Promise<ModelProfile>;
}

/** The TaskManager's deps; board mode's lanes reuse them (getters kept), each with its own store, turns and routing. */
export function createTaskDeps(d: TaskDepsDeps): TaskDeps {
  const {
    runtime,
    hooks,
    turns,
    validConfig,
    baseOf,
    taskStoreOptions,
    scoped,
    activeScope,
    dataStoreFor,
    materialStore,
    sendContext,
    closeRuntime,
    readPhaseBrief,
    sendToWindow,
    currentHistory,
    emit,
    pickProfile,
    supportedEffort,
  } = d;
  const taskDeps: TaskDeps = {
    store: {
      load: async () => {
        const c = await validConfig();
        return c ? new TaskStore(baseOf(c), taskStoreOptions()).load() : emptyTasks();
      },
      save: async (state) => {
        const c = await validConfig();
        if (c) await new TaskStore(baseOf(c), taskStoreOptions()).save(state);
      },
    },
    // `single` mode: through the gate's `tasks` cap, apart from the job turns. A getter: the mode is known once the app is ready.
    get turns() {
      return d.single()?.turns ?? turns;
    },
    // A task closed with its note saved: the jobs' `afterTask` (Decision 6). A getter: undefined without jobs (D0).
    // And the mods' taskClose hook (minimal-core spec §4).
    get taskClosed() {
      const jobs = d.jobsHost();
      const mods = d.modHost();
      if (!jobs && !mods) return undefined;
      return (t: { id: string; action?: string; scope: string }) => {
        jobs?.taskClosed(t);
        if (mods) void mods.taskClose(t);
      };
    },
    // The mods' taskOpen hook (minimal-core spec §4). A getter: undefined without a mod host (D0).
    get taskOpened() {
      const mods = d.modHost();
      return mods ? (t: { id: string; action?: string; scope: string }) => void mods.taskOpen(t) : undefined;
    },
    get actions() {
      return d.harness().actions;
    },
    get scoped() {
      return scoped();
    },
    // An archived scope can't be opened (spec §3.4): it counts as missing here.
    scopeExists: (id) => activeScope(id),
    // A getter, because the harness is loaded after this object is built. Undefined without input blocks (D0).
    get inputBlocks() {
      const blocks = inputBlocks(d.harness().blocks);
      return Object.keys(blocks).length > 0 ? blocks : undefined;
    },
    markAnswered: async (chat, answer) => {
      const c = await validConfig();
      // `false` means "no such block in the chat"; a missing folder is a different failure.
      if (!c) throw new Error("No valid configuration: the chat log can't be found");
      return new ChatLog(baseOf(c), c.engineId, chat).markAnswered(answer);
    },
    // As the person, through the data store's checks (spec §6); the write goes out with the follow-up's commit.
    saveAnswer: (collection, records, scope) =>
      saveAnswerRecords(
        async () => {
          const c = await validConfig();
          return c ? dataStoreFor(baseOf(c)) : null;
        },
        collection,
        records,
        scope,
      ),
    // Spec §4.4: only a harness with a collection that goes into the context gets the hook (D2).
    // A getter, because the harness is loaded after this object is built.
    // Plugins' tables follow the harness's (Decision 16); none: "" adds nothing to the first message.
    get dataContext() {
      const own = Object.values(d.harness().data).some((c) => c.context !== false);
      const plugins = d.pluginsCtl();
      if (!own && !plugins) return undefined;
      return async (scope: string, action: string | undefined) => {
        const c = await validConfig();
        // One part per collection: the context panel lists each (context-panel spec §3.1); the agent gets them joined.
        const tables = c && own ? await buildDataContextParts(dataStoreFor(baseOf(c)), d.harness().data, scope, action) : [];
        const extra = plugins ? await plugins.contextParts(action) : [];
        return [...tables, ...extra];
      };
    },
    // Context panel (context-panel spec §3.1): the size of AGENTS.md in the agent's working folder.
    instructionsSize: async () => {
      const c = await validConfig();
      if (!c) return null;
      const stat = await fs.stat(path.join(baseOf(c), "AGENTS.md")).catch(() => null);
      return stat?.isFile() ? stat.size : null;
    },
    // Pins and exclusions for a new task (spec §4); `contextSvc` is built below, before any task can start.
    personContext: (scope) => d.contextSvc().personContext(scope),
    contextChanged: (id) => void sendContext(id),
    // The agent's working folder: the engine's read paths become folder paths (spec §3.2).
    folder: async () => {
      const c = await validConfig();
      return c ? baseOf(c) : null;
    },
    // Material spec §9 Load: only a harness with material gets the hook (D0). A getter: the harness loads later.
    // Only usable sources' fragments make rows (`indexRows`); none: no section.
    get materialContext() {
      const m = d.harness().material;
      if (!m) return undefined;
      // `budgetTokens`: the task's context policy's (replaceable-parts §7.1); absent (a job run), the manifest's.
      return async (scope: string, budgetTokens?: number) => {
        const c = await validConfig();
        if (!c || scope === APP_SCOPE || !isScopeId(scope)) return "";
        const store = materialStore(baseOf(c), scope);
        const rows = await store.indexRows();
        if (rows.length === 0) return "";
        return materialSection({ mode: groundingMode(await store.grounding(), m.grounding), sheet: await store.sheet(), rows, budgetTokens: budgetTokens ?? m.budget.indexTokens });
      };
    },
    // The manifest's material index budget, which the default context policy's start plan passes back (replaceable-parts §7.1).
    get materialIndexTokens() {
      return d.harness().material?.budget.indexTokens;
    },
    // The scope's approved engine preset for each task (hatches spec §5.2). A getter: undefined without enginePresets (D0).
    get enginePreset() {
      return d.engineHost();
    },
    // Board mode only (hatches Decision 6): AGENTS.md is shared by lanes in different scopes, so each task's first message
    // names its own scope's folders. A getter: undefined without linked folders (D0) or outside board mode.
    get linkedContext() {
      const linked = d.linked();
      return linked && d.host() ? (scope: string) => linked.access.section(scope) : undefined;
    },
    get path() {
      return d.harness().path ?? [];
    },
    // A getter, because the harness is loaded after this object is built. Undefined without settings (D0).
    get betweenTasks() {
      const settings = d.settingsCtl();
      const plugins = d.pluginsCtl();
      const linked = d.linked();
      // The mods' betweenTasks (minimal-core 1a): only while some mod that is on registered one (D0).
      const mods = d.modHost()?.registered("betweenTasks") ? d.modHost() : null;
      if (!settings && !plugins && !linked && !mods) return undefined;
      return async () => {
        await settings?.betweenTasks();
        // A link change a running turn kept from AGENTS.md, or another scope opened since it was written.
        await linked?.instructions.betweenTasks();
        await mods?.betweenTasks();
        // Plugin settings reach AGENTS.md; plugin collections coming or going need a runtime with (or without) them.
        await plugins?.betweenTasks();
        // Board mode closes the workspace only once no task is open (Decision 13).
        if (plugins?.takeRuntimeStale()) {
          const host = d.host();
          await (host ? host.runtimeStale() : closeRuntime());
        }
      };
    },
    // The mods' turn hooks (minimal-core spec §4; Sidekick's after-reply moment is its turnEnd). Getters: undefined
    // until the host exists (D0).
    get turnStarting() {
      const mods = d.modHost();
      if (!mods) return undefined;
      return () => {
        void d.tasks().runningTask().then((t) => t && mods.turnStart(t)).catch((err: unknown) => console.error("The mods' turnStart failed", err));
      };
    },
    get turnEnded() {
      const mods = d.modHost();
      if (!mods) return undefined;
      // Every turn with its kind: the host hands a core mod all of them, any other mod only the person's (`run`).
      return (end: TurnEnd) => void mods.turnEnd({ ...toTurnEnd(end), kind: end.kind });
    },
    // The mods' phaseMoved (Sidekick's process-guard, sidekick spec §2a.2), only while some mod that is on registered
    // one. A getter for the same reason (D0).
    get phaseMoved() {
      const mods = d.modHost()?.registered("phaseMoved") ? d.modHost() : null;
      if (!mods) return undefined;
      return (e: PhaseMoved) => void mods.phaseMoved(e);
    },
    // An action's pre-steps and a part's expects (tools spec §6, §6.1). Getters: undefined without tools (no toolsHost)
    // or when no action declares them (D0).
    get prepare() {
      const tools = d.toolsHost();
      return tools && hasPre(d.harness()) ? tools.prepare : undefined;
    },
    get phaseEnded() {
      const tools = d.toolsHost();
      return tools && hasExpects(d.harness()) ? tools.phaseEnded : undefined;
    },
    // Getters, because the harness is loaded after this object is built. Undefined without modes (task-modes D0).
    get modes() {
      return hasModes(d.harness()) ? d.harness().modes : undefined;
    },
    readModeBrief: (mode) => {
      if (!Object.hasOwn(d.harness().modes, mode)) return Promise.reject(new Error("Unknown mode"));
      return fs.readFile(resolveInHarness(d.harness(), d.harness().modes[mode].brief), "utf8");
    },
    readPhaseBrief,
    // Before the turn's events: the window draws the change's separator or the wrap-up line (task-phases spec §4.4, §5).
    taskTurn: (notice) => sendToWindow("hh:taskTurn", notice),
    ...(hooks.minuteMs ? { minuteMs: hooks.minuteMs } : {}),
    // A getter, because the harness is loaded after this object is built. Undefined without interview steps (setup-steps D0).
    get interviews() {
      const map = interviewCollections(d.harness());
      return Object.keys(map).length > 0 ? map : undefined;
    },
    // Mode settings live in the settings controller (harness-settings spec §6); without settings there are none.
    modeSettings: async (mode) => {
      const settings = d.settingsCtl();
      return settings ? settings.modeSentences(mode) : [];
    },
    // Fast on purpose (it runs in the task queue): the saved model table only, never the engine's offer.
    tierOf: async (profile) => nearestTier(profile, cleanModels((await d.config().load()).models)),
    readPrompt: (action) => fs.readFile(resolveInHarness(d.harness(), d.harness().actions[action].prompt), "utf8"),
    language: async () => (await d.config().load()).language ?? DEFAULT_LANGUAGE,
    engine: async () => (await d.config().load()).engineId ?? "",
    notes: async (scope) => {
      const c = await validConfig();
      return c ? readNotes(baseOf(c), notesPrefix(scoped(), scope)) : [];
    },
    writeNote: async (slug, note, meta, scope) => {
      const c = await validConfig();
      if (!c) throw new Error("The app is not set up yet");
      await writeNote(baseOf(c), slug, note, meta, notesPrefix(scoped(), scope));
      if (d.single()) d.setSingleNote(notePath(scoped(), scope, slug));
    },
    noteExists: async (slug, scope) => {
      const c = await validConfig();
      return c ? fs.access(path.join(baseOf(c), notesPrefix(scoped(), scope), `${slug}.md`)).then(() => true, () => false) : false;
    },
    endSession: async () => {
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.endSession();
    },
    saveHistory: async (message, trailer) => {
      const own = d.singleNote();
      d.setSingleNote(undefined);
      // `single` mode while a job runs: the note's file alone, never the run's work (parallel spec §5.3).
      if (d.jobsHost()?.running()) return saveAppChange(await currentHistory(), true, own ? [own] : [], message, trailer);
      await (await currentHistory())?.save(message, trailer);
    },
    changed: (view) => sendToWindow("hh:tasks", view),
    emit,
    // The ids a new task starts with (replaceable-parts §8): config.json's, already cleaned by ConfigStore.load().
    policies: async () => (await d.config().load()).policies ?? {},
    // `policies`: the task's own ids, fixed when it started; none passed runs the defaults (never config.json's now).
    profileFor: async (action, floor, tier, policies) => {
      const c = await d.config().load();
      const engine = c.engineId ?? "";
      const models = cleanModels(c.models);
      // `tier`: a plugin action's prepared task (plugins spec §5.3) or a core review task (review spec §11.3); otherwise
      // the action's, or the free questions'.
      // `floor`: the mode's minTier when a task restarts in that mode (task-modes spec §5.3); passed only when there is one.
      // Codex: a model its saved list lacks falls back before the turn (spec §5.3).
      return pickProfile(policies?.model, { engine, action, manifestTier: manifestTier(d.harness(), action, tier), models, ...(floor ? { floor } : {}) });
    },
    fallbackFor: async (profile, tried, policies) => {
      const c = await d.config().load();
      const next = modelPolicy(policies?.model).fallback(profile, cleanModels(c.models), tried);
      return next ? supportedEffort(next) : null;
    },
    fitProfile: (profile) => supportedEffort(profile),
    recordCompaction: async (task) => {
      const c = await validConfig();
      if (!c) return;
      await new UsageLog(baseOf(c)).append(
        compactionRecord(c.engineId, {
          ...(task.action ? { action: task.action } : {}),
          task: task.id,
          ...(task.mode ? { mode: task.mode } : {}),
          ...(task.phase ? { taskPhase: task.phase.id } : {}),
          ...(task.profile ? profileMeta(task.profile) : {}),
          ...policyMeta(task.policies),
        }),
      );
    },
  };
  return taskDeps;
}
