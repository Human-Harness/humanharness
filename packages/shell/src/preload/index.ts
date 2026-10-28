import { contextBridge, ipcRenderer } from "electron";
import type {
  DataChangeView,
  Event,
  HarnessClient,
  MaterialView,
  ModeResult,
  ModeSwitch,
  ProfilesState,
  ScopesView,
  SettingsState,
  SetupOutput,
  SetupStepsState,
  SidekickState,
  TaskTurnNotice,
  TaskView,
  TextSize,
} from "@humanharness/ui/client";
import { hearsDataChange } from "@humanharness/ui/data-change";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/** Told of every mode switch, whoever called `chooseMode` (the window or the harness's own UI). */
const modeSwitches = new Set<(s: ModeSwitch) => void>();

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
  scopes: {
    list: () => ipcRenderer.invoke("hh:scopes"),
    create: (title) => ipcRenderer.invoke("hh:scopeCreate", title),
    rename: (id, title) => ipcRenderer.invoke("hh:scopeRename", id, title),
    archive: (id) => ipcRenderer.invoke("hh:scopeArchive", id, true),
    unarchive: (id) => ipcRenderer.invoke("hh:scopeArchive", id, false),
    open: (id) => ipcRenderer.invoke("hh:scopeOpen", id),
    current: () => ipcRenderer.invoke("hh:scopeCurrent"),
    onChange: (listener) => subscribe<ScopesView>("hh:scopes", listener),
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
    onChange: (listener) => subscribe<SidekickState>("hh:sidekick", listener),
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
  onTextSize: (listener) => subscribe<TextSize>("hh:textSize", listener),
};

contextBridge.exposeInMainWorld("hh", client);
