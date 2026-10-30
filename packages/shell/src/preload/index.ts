import { contextBridge, ipcRenderer } from "electron";
import type {
  AttentionView,
  ConnectionsView,
  ContextGetResult,
  ContextPick,
  ContextResult,
  DataChangeView,
  Event,
  FileDiffResult,
  FileTimelineResult,
  FocusState,
  HarnessClient,
  JobSummary,
  MaterialView,
  ModeResult,
  ModeSwitch,
  PluginDataChange,
  PluginSurfaceView,
  PluginsView,
  ProfilesState,
  ReviewSummary,
  ScopesView,
  SettingsState,
  SetupOutput,
  SetupStepsState,
  SidekickState,
  TaskTurnNotice,
  TasksState,
  TaskView,
  ToolsInfo,
  TextSize,
} from "@humanharness/protocol";
import { hearsDataChange } from "@humanharness/protocol/data-change";
import { backendClient } from "./backend";
import { askContext, contextListener } from "./context";
import { documentWatcher } from "./document-watch";
import { fileCommitListeners } from "./file-commits";
import { askFile, restoreFlow } from "./file-restore";
import { languageClient } from "./language";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/** Told of every mode switch, whoever called `chooseMode` (the window or the harness's own UI). */
const modeSwitches = new Set<(s: ModeSwitch) => void>();

/** Told of every `openDocument`, from the window or the harness's own UI (document-reader spec §5.1). */
const documentOpeners = new Set<(path: string, anchor?: string) => void>();
/** Told of every `documents.focus(path)` (review spec §6.2). */
const focusOpeners = new Set<(path: string) => void>();
/** Focus mode as the chat set it last, and who listens. */
let focusState: FocusState = { on: false };
const focusListeners = new Set<(state: FocusState) => void>();
const fileInvoke = (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args);

/** Every `files.onChange`, on one `hh:fileCommits` listener. */
const fileCommits = fileCommitListeners((listener) => subscribe<unknown>("hh:fileCommits", listener));

const client: HarnessClient = {
  getState: () => ipcRenderer.invoke("hh:getState"),
  pickFolder: (defaultPath) => ipcRenderer.invoke("hh:pickFolder", defaultPath),
  saveConfig: (patch) => ipcRenderer.invoke("hh:saveConfig", patch),
  loadChat: () => ipcRenderer.invoke("hh:loadChat"),
  send: (message, options) => ipcRenderer.invoke("hh:send", message, options ?? {}),
  cancel: () => ipcRenderer.invoke("hh:cancel"),
  onEvent: (listener) => subscribe<Event>("hh:event", listener),
  restore: (sha) => ipcRenderer.invoke("hh:restore", sha),
  historyTasks: () => ipcRenderer.invoke("hh:historyTasks"),
  restoreTask: (taskId) => ipcRenderer.invoke("hh:restoreTask", taskId),
  engineStatus: (engineId) => ipcRenderer.invoke("hh:engineStatus", engineId),
  acceptNotice: (engineId) => ipcRenderer.invoke("hh:acceptNotice", engineId),
  runSetup: (engineId, step) => ipcRenderer.invoke("hh:runSetup", engineId, step),
  setupInput: (text) => ipcRenderer.invoke("hh:setupInput", text),
  cancelSetup: () => ipcRenderer.invoke("hh:cancelSetup"),
  onSetupOutput: (listener) => subscribe<SetupOutput>("hh:setupOutput", listener),
  getSetup: () => ipcRenderer.invoke("hh:getSetup"),
  testEngine: (engineId) => ipcRenderer.invoke("hh:testEngine", engineId),
  revealSharedConfig: () => ipcRenderer.invoke("hh:revealSharedConfig"),
  copyInstallCommand: (engineId: string) => ipcRenderer.invoke("hh:copyInstallCommand", engineId),
  copySetupCommand: (engineId: string, step: "login" | "logout") => ipcRenderer.invoke("hh:copySetupCommand", engineId, step),
  openTerminal: () => ipcRenderer.invoke("hh:openTerminal"),
  resetSharedConfig: () => ipcRenderer.invoke("hh:resetSharedConfig"),
  getUsage: () => ipcRenderer.invoke("hh:getUsage"),
  revealFolder: () => ipcRenderer.invoke("hh:revealFolder"),
  moveFolder: (to) => ipcRenderer.invoke("hh:moveFolder", to),
  getTasks: () => ipcRenderer.invoke("hh:getTasks"),
  onTasks: (listener) => subscribe<TaskView>("hh:tasks", listener),
  choose: (option, task) => ipcRenderer.invoke("hh:choose", option, task),
  respond: (blockId, value) => ipcRenderer.invoke("hh:respond", blockId, value),
  chooseMode: async (mode, choice) => {
    const result: ModeResult = await ipcRenderer.invoke("hh:chooseMode", mode, choice ?? {});
    // Before the caller hears it: the chat draws the switch's line before its turn's events.
    if (result.ok && result.switched !== "same") for (const l of modeSwitches) l({ mode, switched: result.switched });
    return result;
  },
  onModeSwitch: (listener) => {
    modeSwitches.add(listener);
    return () => void modeSwitches.delete(listener);
  },
  setPhase: (taskId, phaseId) => ipcRenderer.invoke("hh:setPhase", taskId, phaseId),
  finishTask: () => ipcRenderer.invoke("hh:finishTask"),
  pauseTask: () => ipcRenderer.invoke("hh:pauseTask"),
  resumeTask: () => ipcRenderer.invoke("hh:resumeTask"),
  extendTimeBox: () => ipcRenderer.invoke("hh:extendTimeBox"),
  onTaskTurn: (listener) => subscribe<TaskTurnNotice>("hh:taskTurn", listener),
  openPath: (file) => ipcRenderer.invoke("hh:openPath", file),
  revealPath: (file) => ipcRenderer.invoke("hh:revealPath", file),
  readDocument: (file) => ipcRenderer.invoke("hh:readDocument", file),
  readImage: (file) => ipcRenderer.invoke("hh:readImage", file),
  documentsExist: (paths) => ipcRenderer.invoke("hh:documentsExist", paths),
  watchDocument: documentWatcher(ipcRenderer),
  openDocument: (file, anchor) => {
    for (const l of [...documentOpeners]) l(file, anchor);
  },
  onOpenDocument: (listener) => {
    documentOpeners.add(listener);
    return () => void documentOpeners.delete(listener);
  },
  // Reviews (review spec §5.6): main answers every call with data.
  documents: {
    view: (file) => ipcRenderer.invoke("hh:reviewView", file),
    review: async (file) => ((await ipcRenderer.invoke("hh:reviewSummaries", [file])) as (ReviewSummary | null)[])[0] ?? null,
    summaries: (paths) => ipcRenderer.invoke("hh:reviewSummaries", paths),
    answer: (file, id, pick) => ipcRenderer.invoke("hh:reviewAnswer", file, id, pick),
    comment: (file, input) => ipcRenderer.invoke("hh:reviewComment", file, input),
    editDraft: (file, id, text) => ipcRenderer.invoke("hh:reviewEditDraft", file, id, text),
    reopen: (file, id) => ipcRenderer.invoke("hh:reviewReopen", file, id),
    send: (file) => ipcRenderer.invoke("hh:reviewSend", file),
    approve: (file, blob, opts) =>
      ipcRenderer.invoke("hh:reviewApprove", file, blob, { ...(opts?.reason !== undefined ? { reason: opts.reason } : {}), ...(opts?.discard ? { discard: true } : {}) }),
    approvedText: (file) => ipcRenderer.invoke("hh:reviewApprovedText", file),
    onChange: (listener) => subscribe<string>("hh:reviewChanged", listener),
    focus: (file) => {
      for (const l of [...focusOpeners]) l(file);
    },
    onFocus: (listener) => {
      focusOpeners.add(listener);
      return () => void focusOpeners.delete(listener);
    },
  },
  focus: {
    current: () => focusState,
    onChange: (listener) => {
      focusListeners.add(listener);
      return () => void focusListeners.delete(listener);
    },
    /** The core's chat only. Any value it is given (even null from a harness view) becomes a well-formed state. */
    set: (state) => {
      focusState = { on: state?.on === true, ...(typeof state?.path === "string" ? { path: state.path } : {}) };
      for (const l of [...focusListeners]) l(focusState);
    },
  },
  files: {
    timeline: (file) => askFile<FileTimelineResult>(fileInvoke, "hh:fileTimeline", file),
    diff: (file, from, to) => askFile<FileDiffResult>(fileInvoke, "hh:fileDiff", file, from, to),
    // Main asks with its native dialog before the file goes back; no code in the window can answer for the person.
    restore: (file, commit) => restoreFlow(fileInvoke, file, commit),
    onChange: (file, listener) => fileCommits.onChange(file, listener),
  },
  scopes: {
    list: () => ipcRenderer.invoke("hh:scopes"),
    create: (title) => ipcRenderer.invoke("hh:scopeCreate", title),
    rename: (id, title) => ipcRenderer.invoke("hh:scopeRename", id, title),
    archive: (id) => ipcRenderer.invoke("hh:scopeArchive", id, true),
    unarchive: (id) => ipcRenderer.invoke("hh:scopeArchive", id, false),
    open: (id) => ipcRenderer.invoke("hh:scopeOpen", id),
    current: () => ipcRenderer.invoke("hh:scopeCurrent"),
    onChange: (listener) => subscribe<ScopesView>("hh:scopes", listener),
    // Harnesses with linked folders only (main registers these channels then, hatches D0). No path ever goes to link.
    linked: (scope) => ipcRenderer.invoke("hh:scopeLinked", scope),
    linkFolder: (scope, key) => ipcRenderer.invoke("hh:scopeLinkFolder", scope, key),
    unlinkFolder: (scope, key, path) => ipcRenderer.invoke("hh:scopeUnlinkFolder", scope, key, path),
    confirmGit: (scope, key, path, tracked) => ipcRenderer.invoke("hh:scopeConfirmGit", scope, key, path, tracked),
    linkedHistory: () => ipcRenderer.invoke("hh:linkedHistory"),
  },
  data: {
    get: (collection, key, options) => ipcRenderer.invoke("hh:data", { op: "get", collection, ...(key !== undefined ? { key } : {}) }, options),
    query: (collection, query = {}, options) => ipcRenderer.invoke("hh:data", { op: "query", collection, ...query }, options),
    put: (collection, record, options) => ipcRenderer.invoke("hh:data", { op: "put", collection, record }, options),
    patch: (collection, key, patch, options) => ipcRenderer.invoke("hh:data", { op: "patch", collection, ...(key !== undefined ? { key } : {}), patch }, options),
    delete: (collection, key, options) => ipcRenderer.invoke("hh:data", { op: "delete", collection, ...(key !== undefined ? { key } : {}) }, options),
    subscribe: (collection, scope, listener) =>
      subscribe<DataChangeView>("hh:dataChange", (change) => {
        if (hearsDataChange(change, collection, scope)) listener(change);
      }),
  },
  dataDiff: (taskId) => ipcRenderer.invoke("hh:dataDiff", taskId),
  settings: {
    get: () => ipcRenderer.invoke("hh:settingsGet"),
    set: (field, value) => ipcRenderer.invoke("hh:settingsSet", field, value),
    reset: () => ipcRenderer.invoke("hh:settingsReset"),
    onChange: (listener) => subscribe<SettingsState>("hh:settings", listener),
  },
  sidekick: {
    get: () => ipcRenderer.invoke("hh:sidekickGet"),
    set: (patch) => ipcRenderer.invoke("hh:sidekickSet", patch),
    review: (req) => ipcRenderer.invoke("hh:sidekickReview", req),
    cancelReview: () => ipcRenderer.invoke("hh:sidekickCancel"),
    resolve: (id, outcome) => ipcRenderer.invoke("hh:sidekickResolve", id, outcome),
    mute: (id) => ipcRenderer.invoke("hh:sidekickMute", id),
    unmute: (sidekick, kind) => ipcRenderer.invoke("hh:sidekickUnmute", sidekick, kind),
    saveDecision: (id) => ipcRenderer.invoke("hh:sidekickSaveDecision", id),
    learned: () => ipcRenderer.invoke("hh:sidekickLearned"),
    forget: (id) => ipcRenderer.invoke("hh:sidekickForget", id),
    forgetAll: () => ipcRenderer.invoke("hh:sidekickForgetAll"),
    editLearned: (changes) => ipcRenderer.invoke("hh:sidekickEditLearned", changes),
    beforeApprove: (doc) => ipcRenderer.invoke("hh:sidekickBeforeApprove", doc),
    cancelApprove: () => ipcRenderer.invoke("hh:sidekickApproveCancel"),
    ask: (place, content) => ipcRenderer.invoke("hh:sidekickAsk", place, content),
    presets: () => ipcRenderer.invoke("hh:sidekickPresets"),
    adoptPreset: (name) => ipcRenderer.invoke("hh:sidekickAdoptPreset", name),
    pickFiles: () => ipcRenderer.invoke("hh:sidekickPickFiles"),
    importDraft: (input) => ipcRenderer.invoke("hh:sidekickImportDraft", input),
    checkOriginal: (id) => ipcRenderer.invoke("hh:sidekickCheckOriginal", id),
    saveSidekick: (def, learned) => ipcRenderer.invoke("hh:sidekickSave", def, learned),
    list: () => ipcRenderer.invoke("hh:sidekickList"),
    remove: (id) => ipcRenderer.invoke("hh:sidekickRemove", id),
    reorder: (ids) => ipcRenderer.invoke("hh:sidekickReorder", ids),
    scope: (scope) => ipcRenderer.invoke("hh:sidekickScope", scope),
    setScope: (scope, sidekick, v) => ipcRenderer.invoke("hh:sidekickSetScope", scope, sidekick, v),
    onChange: (listener) => subscribe<SidekickState>("hh:sidekick", listener),
  },
  plugins: {
    get: () => ipcRenderer.invoke("hh:pluginsGet"),
    rescan: () => ipcRenderer.invoke("hh:pluginsRescan"),
    setOn: (id, on) => ipcRenderer.invoke("hh:pluginsSetOn", id, on),
    pick: () => ipcRenderer.invoke("hh:pluginsPick"),
    add: (token) => ipcRenderer.invoke("hh:pluginsAdd", token),
    approve: (id, distHash) => ipcRenderer.invoke("hh:pluginsApprove", id, distHash),
    remove: (id) => ipcRenderer.invoke("hh:pluginsRemove", id),
    detail: (id) => ipcRenderer.invoke("hh:pluginsDetail", id),
    setSetting: (id, field, value) => ipcRenderer.invoke("hh:pluginsSetSetting", id, field, value),
    resetSettings: (id) => ipcRenderer.invoke("hh:pluginsResetSettings", id),
    setWorkHours: (id, wh) => ipcRenderer.invoke("hh:pluginsSetWorkHours", id, wh),
    setSecret: (id, secret, value) => ipcRenderer.invoke("hh:pluginsSetSecret", id, secret, value),
    deleteSecret: (id, secret) => ipcRenderer.invoke("hh:pluginsDeleteSecret", id, secret),
    setNotify: (id, on) => ipcRenderer.invoke("hh:pluginsSetNotify", id, on),
    test: (id) => ipcRenderer.invoke("hh:pluginsTest", id),
    refresh: (id, source) => ipcRenderer.invoke("hh:pluginsRefresh", id, source),
    onChange: (listener) => subscribe<PluginsView>("hh:plugins", listener),
    surface: () => ipcRenderer.invoke("hh:pluginsSurface"),
    panel: (plugin, panel, call, args) => ipcRenderer.invoke("hh:pluginsPanel", plugin, panel, call, args),
    startPrepared: (token) => ipcRenderer.invoke("hh:pluginsStartPrepared", token),
    cancelPrepared: (token) => ipcRenderer.invoke("hh:pluginsCancelPrepared", token),
    onSurface: (listener) => subscribe<PluginSurfaceView>("hh:pluginSurface", listener),
    onPluginData: (listener) => subscribe<PluginDataChange>("hh:pluginData", listener),
  },
  attention: {
    get: () => ipcRenderer.invoke("hh:attentionGet"),
    dismiss: (plugin, key) => ipcRenderer.invoke("hh:attentionDismiss", plugin, key),
    read: (plugin, key) => ipcRenderer.invoke("hh:attentionRead", plugin, key),
    open: (plugin, key) => ipcRenderer.invoke("hh:attentionOpen", plugin, key),
    onChange: (listener) => subscribe<AttentionView>("hh:attention", listener),
  },
  // Main registers these only when the harness declares secrets (D0). Only `set` sends a value; none comes back.
  connections: {
    get: () => ipcRenderer.invoke("hh:connectionsGet"),
    set: (id, value) => ipcRenderer.invoke("hh:connectionsSet", id, value),
    delete: (id) => ipcRenderer.invoke("hh:connectionsDelete", id),
    test: (id) => ipcRenderer.invoke("hh:connectionsTest", id),
    onChange: (listener) => subscribe<ConnectionsView>("hh:connectionsChange", listener),
  },
  // Main registers these only when the harness declares tools (D0). The page names a tool and its arguments, never a
  // caller, task or scope.
  tools: {
    call: (id, args) => ipcRenderer.invoke("hh:toolsCall", id, args),
    trace: (id) => ipcRenderer.invoke("hh:toolsTrace", id),
    onChange: (listener) => subscribe<ToolsInfo>("hh:toolsChange", listener),
  },
  // Main's board-mode inbox channels; plain mode refuses every call and never sends hh:tasksChange (D0).
  tasks: {
    list: () => ipcRenderer.invoke("hh:tasksList"),
    onChange: (listener) => subscribe<TasksState>("hh:tasksChange", listener),
    focus: (id) => ipcRenderer.invoke("hh:tasksFocus", id),
    cancelQueued: (id) => ipcRenderer.invoke("hh:tasksCancelQueued", id),
    resumeQueues: () => ipcRenderer.invoke("hh:tasksResume"),
  },
  // Main's jobs channels (part 3); without jobs main refuses every call and never sends hh:jobsChange (D0).
  jobs: {
    list: () => ipcRenderer.invoke("hh:jobsList"),
    run: (id, scope) => ipcRenderer.invoke("hh:jobsRun", id, scope),
    onChange: (listener) => subscribe<JobSummary[]>("hh:jobsChange", listener),
  },
  setupSteps: {
    get: () => ipcRenderer.invoke("hh:setupStepsGet"),
    values: (id) => ipcRenderer.invoke("hh:setupStepValues", id),
    submit: (id, value) => ipcRenderer.invoke("hh:setupStepSubmit", id, value),
    complete: (id) => ipcRenderer.invoke("hh:setupStepComplete", id),
    skip: (id) => ipcRenderer.invoke("hh:setupStepSkip", id),
    finish: () => ipcRenderer.invoke("hh:setupStepsFinish"),
    acknowledge: () => ipcRenderer.invoke("hh:setupStepsAcknowledge"),
    onChange: (listener) => subscribe<SetupStepsState>("hh:setupSteps", listener),
  },
  profiles: {
    get: () => ipcRenderer.invoke("hh:profilesGet"),
    create: (values) => ipcRenderer.invoke("hh:profileCreate", values),
    open: (id) => ipcRenderer.invoke("hh:profileOpen", id),
    archive: (id) => ipcRenderer.invoke("hh:profileArchive", id, true),
    unarchive: (id) => ipcRenderer.invoke("hh:profileArchive", id, false),
    edit: (values) => ipcRenderer.invoke("hh:profileEdit", values),
    delete: (id) => ipcRenderer.invoke("hh:profileDelete", id),
    onChange: (listener) => subscribe<ProfilesState>("hh:profiles", listener),
  },
  material: {
    list: (scope) => ipcRenderer.invoke("hh:materialList", scope),
    add: (scope) => ipcRenderer.invoke("hh:materialAdd", scope),
    addLink: (scope, url) => ipcRenderer.invoke("hh:materialAddLink", scope, url),
    confirm: (scope, id, choice) => ipcRenderer.invoke("hh:materialConfirm", scope, id, choice),
    setGrounding: (scope, mode) => ipcRenderer.invoke("hh:materialGrounding", scope, mode),
    retry: (scope, id) => ipcRenderer.invoke("hh:materialRetry", scope, id),
    decide: (scope, id, fragment, choice) => ipcRenderer.invoke("hh:materialDecide", scope, id, fragment, choice),
    remove: (scope, id) => ipcRenderer.invoke("hh:materialRemove", scope, id),
    open: (scope, id) => ipcRenderer.invoke("hh:materialOpen", scope, id),
    cite: (scope, id) => ipcRenderer.invoke("hh:materialCite", scope, id),
    onChange: (listener) => subscribe<MaterialView>("hh:materialStatus", listener),
  },
  // The context panel (context-panel spec §5.2): every answer is data, a rejected invoke included.
  context: {
    get: (taskId) => askContext<ContextGetResult>(fileInvoke, "hh:contextGet", taskId),
    onChange: (taskId, listener) => subscribe<unknown>("hh:context", contextListener(taskId, listener)),
    add: (taskId, file) => askContext<ContextResult>(fileInvoke, "hh:contextAdd", taskId, file),
    pick: () => askContext<ContextPick>(fileInvoke, "hh:contextPick"),
    pin: (scope, file) => askContext<ContextResult>(fileInvoke, "hh:contextPin", scope, file),
    unpin: (scope, file) => askContext<ContextResult>(fileInvoke, "hh:contextUnpin", scope, file),
    exclude: (scope, note) => askContext<ContextResult>(fileInvoke, "hh:contextExclude", scope, note),
    include: (scope, note) => askContext<ContextResult>(fileInvoke, "hh:contextInclude", scope, note),
  },
  onTextSize: (listener) => subscribe<TextSize>("hh:textSize", listener),
  // Language on demand (language spec): every answer is data, a rejected invoke included.
  language: languageClient(fileInvoke, (channel, listener) => subscribe<unknown>(channel, listener)),
  // The harness's backend (hatches spec §4.2): main registers its channels only with `backend` (D0).
  backend: backendClient(fileInvoke, (channel, listener) => subscribe<unknown>(channel, listener)),
  // A scope's engine config (hatches spec §5.3): main registers these channels only with `enginePresets` (D0). The
  // hash sent back is the one the view carried; main computes it again and approves only when equal.
  engineConfig: {
    get: (scope) => ipcRenderer.invoke("hh:engineConfig", scope),
    approve: (scope, hash) => ipcRenderer.invoke("hh:engineApprove", scope, hash),
    revoke: (scope) => ipcRenderer.invoke("hh:engineRevoke", scope),
    onChanged: (listener) => subscribe<string | null>("hh:engineConfigChanged", listener),
  },
};

contextBridge.exposeInMainWorld("hh", client);
