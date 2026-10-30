import { contextBridge, ipcRenderer } from "electron";
import type { InvokeArgs, InvokeChannel } from "@humanharness/protocol/channels";
import type { FocusState, HarnessClient, ModeSwitch } from "@humanharness/protocol";
import { hearsDataChange } from "@humanharness/protocol/data-change";
import { backendClient } from "./backend";
import { askContext, contextListener } from "./context";
import { documentWatcher } from "./document-watch";
import { fileCommitListeners } from "./file-commits";
import { askFile, restoreFlow } from "./file-restore";
import { invoke, subscribe } from "./ipc";
import { languageClient } from "./language";

/** Told of every mode switch, whoever called `chooseMode` (the window or the harness's own UI). */
const modeSwitches = new Set<(s: ModeSwitch) => void>();

/** Told of every `openDocument`, from the window or the harness's own UI (document-reader spec §5.1). */
const documentOpeners = new Set<(path: string, anchor?: string) => void>();
/** Told of every `documents.focus(path)` (review spec §6.2). */
const focusOpeners = new Set<(path: string) => void>();
/** Focus mode as the chat set it last, and who listens. */
let focusState: FocusState = { on: false };
const focusListeners = new Set<(state: FocusState) => void>();
/** `invoke` as the helpers their tests drive with a fake take it (`./context`'s `Invoke`): a table channel, any arguments. */
const looseInvoke = (channel: InvokeChannel, ...args: unknown[]): Promise<unknown> => invoke(channel, ...(args as InvokeArgs<InvokeChannel>));

/** `hh:data`'s answer is its op's (`Invoke["hh:data"]`): `T` is the answer the calling `data` method promises. */
const askData = <T>(...args: InvokeArgs<"hh:data">) => invoke("hh:data", ...args) as Promise<T>;

/** Every `files.onChange`, on one `hh:fileCommits` listener. */
const fileCommits = fileCommitListeners((listener) => subscribe("hh:fileCommits", listener));

const client: HarnessClient = {
  getState: () => invoke("hh:getState"),
  pickFolder: (defaultPath) => invoke("hh:pickFolder", defaultPath),
  saveConfig: (patch) => invoke("hh:saveConfig", patch),
  loadChat: () => invoke("hh:loadChat"),
  send: (message, options) => invoke("hh:send", message, options ?? {}),
  cancel: () => invoke("hh:cancel"),
  onEvent: (listener) => subscribe("hh:event", listener),
  restore: (sha) => invoke("hh:restore", sha),
  historyTasks: () => invoke("hh:historyTasks"),
  restoreTask: (taskId) => invoke("hh:restoreTask", taskId),
  engineStatus: (engineId) => invoke("hh:engineStatus", engineId),
  acceptNotice: (engineId) => invoke("hh:acceptNotice", engineId),
  runSetup: (engineId, step) => invoke("hh:runSetup", engineId, step),
  setupInput: (text) => invoke("hh:setupInput", text),
  cancelSetup: () => invoke("hh:cancelSetup"),
  onSetupOutput: (listener) => subscribe("hh:setupOutput", listener),
  getSetup: () => invoke("hh:getSetup"),
  testEngine: (engineId) => invoke("hh:testEngine", engineId),
  revealSharedConfig: () => invoke("hh:revealSharedConfig"),
  copyInstallCommand: (engineId: string) => invoke("hh:copyInstallCommand", engineId),
  copySetupCommand: (engineId: string, step: "login" | "logout") => invoke("hh:copySetupCommand", engineId, step),
  openTerminal: () => invoke("hh:openTerminal"),
  resetSharedConfig: () => invoke("hh:resetSharedConfig"),
  getUsage: () => invoke("hh:getUsage"),
  revealFolder: () => invoke("hh:revealFolder"),
  moveFolder: (to) => invoke("hh:moveFolder", to),
  getTasks: () => invoke("hh:getTasks"),
  onTasks: (listener) => subscribe("hh:tasks", listener),
  choose: (option, task) => invoke("hh:choose", option, task),
  respond: (blockId, value) => invoke("hh:respond", blockId, value),
  chooseMode: async (mode, choice) => {
    const result = await invoke("hh:chooseMode", mode, choice ?? {});
    // Before the caller hears it: the chat draws the switch's line before its turn's events.
    if (result.ok && result.switched !== "same") for (const l of modeSwitches) l({ mode, switched: result.switched });
    return result;
  },
  onModeSwitch: (listener) => {
    modeSwitches.add(listener);
    return () => void modeSwitches.delete(listener);
  },
  setPhase: (taskId, phaseId) => invoke("hh:setPhase", taskId, phaseId),
  finishTask: () => invoke("hh:finishTask"),
  pauseTask: () => invoke("hh:pauseTask"),
  resumeTask: () => invoke("hh:resumeTask"),
  extendTimeBox: () => invoke("hh:extendTimeBox"),
  onTaskTurn: (listener) => subscribe("hh:taskTurn", listener),
  openPath: (file) => invoke("hh:openPath", file),
  revealPath: (file) => invoke("hh:revealPath", file),
  readDocument: (file) => invoke("hh:readDocument", file),
  readImage: (file) => invoke("hh:readImage", file),
  documentsExist: (paths) => invoke("hh:documentsExist", paths),
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
    view: (file) => invoke("hh:reviewView", file),
    review: async (file) => (await invoke("hh:reviewSummaries", [file]))[0] ?? null,
    summaries: (paths) => invoke("hh:reviewSummaries", paths),
    answer: (file, id, pick) => invoke("hh:reviewAnswer", file, id, pick),
    comment: (file, input) => invoke("hh:reviewComment", file, input),
    editDraft: (file, id, text) => invoke("hh:reviewEditDraft", file, id, text),
    reopen: (file, id) => invoke("hh:reviewReopen", file, id),
    send: (file) => invoke("hh:reviewSend", file),
    approve: (file, blob, opts) =>
      invoke("hh:reviewApprove", file, blob, { ...(opts?.reason !== undefined ? { reason: opts.reason } : {}), ...(opts?.discard ? { discard: true } : {}) }),
    approvedText: (file) => invoke("hh:reviewApprovedText", file),
    onChange: (listener) => subscribe("hh:reviewChanged", listener),
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
    timeline: (file) => askFile(looseInvoke, "hh:fileTimeline", file),
    diff: (file, from, to) => askFile(looseInvoke, "hh:fileDiff", file, from, to),
    // Main asks with its native dialog before the file goes back; no code in the window can answer for the person.
    restore: (file, commit) => restoreFlow(looseInvoke, file, commit),
    onChange: (file, listener) => fileCommits.onChange(file, listener),
  },
  scopes: {
    list: () => invoke("hh:scopes"),
    create: (title) => invoke("hh:scopeCreate", title),
    rename: (id, title) => invoke("hh:scopeRename", id, title),
    archive: (id) => invoke("hh:scopeArchive", id, true),
    unarchive: (id) => invoke("hh:scopeArchive", id, false),
    open: (id) => invoke("hh:scopeOpen", id),
    current: () => invoke("hh:scopeCurrent"),
    onChange: (listener) => subscribe("hh:scopes", listener),
    // Harnesses with linked folders only (main registers these channels then, hatches D0). No path ever goes to link.
    linked: (scope) => invoke("hh:scopeLinked", scope),
    linkFolder: (scope, key) => invoke("hh:scopeLinkFolder", scope, key),
    unlinkFolder: (scope, key, path) => invoke("hh:scopeUnlinkFolder", scope, key, path),
    confirmGit: (scope, key, path, tracked) => invoke("hh:scopeConfirmGit", scope, key, path, tracked),
    linkedHistory: () => invoke("hh:linkedHistory"),
  },
  data: {
    get: (collection, key, options) => askData({ op: "get", collection, ...(key !== undefined ? { key } : {}) }, options),
    query: (collection, query = {}, options) => askData({ op: "query", collection, ...query }, options),
    put: (collection, record, options) => askData({ op: "put", collection, record }, options),
    patch: (collection, key, patch, options) => askData({ op: "patch", collection, ...(key !== undefined ? { key } : {}), patch }, options),
    delete: (collection, key, options) => askData({ op: "delete", collection, ...(key !== undefined ? { key } : {}) }, options),
    subscribe: (collection, scope, listener) =>
      subscribe("hh:dataChange", (change) => {
        if (hearsDataChange(change, collection, scope)) listener(change);
      }),
  },
  dataDiff: (taskId) => invoke("hh:dataDiff", taskId),
  settings: {
    get: () => invoke("hh:settingsGet"),
    set: (field, value) => invoke("hh:settingsSet", field, value),
    reset: () => invoke("hh:settingsReset"),
    onChange: (listener) => subscribe("hh:settings", listener),
  },
  sidekick: {
    get: () => invoke("hh:sidekickGet"),
    set: (patch) => invoke("hh:sidekickSet", patch),
    review: (req) => invoke("hh:sidekickReview", req),
    cancelReview: () => invoke("hh:sidekickCancel"),
    resolve: (id, outcome) => invoke("hh:sidekickResolve", id, outcome),
    mute: (id) => invoke("hh:sidekickMute", id),
    unmute: (sidekick, kind) => invoke("hh:sidekickUnmute", sidekick, kind),
    saveDecision: (id) => invoke("hh:sidekickSaveDecision", id),
    learned: () => invoke("hh:sidekickLearned"),
    forget: (id) => invoke("hh:sidekickForget", id),
    forgetAll: () => invoke("hh:sidekickForgetAll"),
    editLearned: (changes) => invoke("hh:sidekickEditLearned", changes),
    beforeApprove: (doc) => invoke("hh:sidekickBeforeApprove", doc),
    cancelApprove: () => invoke("hh:sidekickApproveCancel"),
    ask: (place, content) => invoke("hh:sidekickAsk", place, content),
    presets: () => invoke("hh:sidekickPresets"),
    adoptPreset: (name) => invoke("hh:sidekickAdoptPreset", name),
    pickFiles: () => invoke("hh:sidekickPickFiles"),
    importDraft: (input) => invoke("hh:sidekickImportDraft", input),
    checkOriginal: (id) => invoke("hh:sidekickCheckOriginal", id),
    saveSidekick: (def, learned) => invoke("hh:sidekickSave", def, learned),
    list: () => invoke("hh:sidekickList"),
    remove: (id) => invoke("hh:sidekickRemove", id),
    reorder: (ids) => invoke("hh:sidekickReorder", ids),
    scope: (scope) => invoke("hh:sidekickScope", scope),
    setScope: (scope, sidekick, v) => invoke("hh:sidekickSetScope", scope, sidekick, v),
    onChange: (listener) => subscribe("hh:sidekick", listener),
  },
  plugins: {
    get: () => invoke("hh:pluginsGet"),
    rescan: () => invoke("hh:pluginsRescan"),
    setOn: (id, on) => invoke("hh:pluginsSetOn", id, on),
    pick: () => invoke("hh:pluginsPick"),
    add: (token) => invoke("hh:pluginsAdd", token),
    approve: (id, distHash) => invoke("hh:pluginsApprove", id, distHash),
    remove: (id) => invoke("hh:pluginsRemove", id),
    detail: (id) => invoke("hh:pluginsDetail", id),
    setSetting: (id, field, value) => invoke("hh:pluginsSetSetting", id, field, value),
    resetSettings: (id) => invoke("hh:pluginsResetSettings", id),
    setWorkHours: (id, wh) => invoke("hh:pluginsSetWorkHours", id, wh),
    setSecret: (id, secret, value) => invoke("hh:pluginsSetSecret", id, secret, value),
    deleteSecret: (id, secret) => invoke("hh:pluginsDeleteSecret", id, secret),
    setNotify: (id, on) => invoke("hh:pluginsSetNotify", id, on),
    test: (id) => invoke("hh:pluginsTest", id),
    refresh: (id, source) => invoke("hh:pluginsRefresh", id, source),
    onChange: (listener) => subscribe("hh:plugins", listener),
    surface: () => invoke("hh:pluginsSurface"),
    panel: (plugin, panel, call, args) => invoke("hh:pluginsPanel", plugin, panel, call, args),
    startPrepared: (token) => invoke("hh:pluginsStartPrepared", token),
    cancelPrepared: (token) => invoke("hh:pluginsCancelPrepared", token),
    onSurface: (listener) => subscribe("hh:pluginSurface", listener),
    onPluginData: (listener) => subscribe("hh:pluginData", listener),
  },
  attention: {
    get: () => invoke("hh:attentionGet"),
    dismiss: (plugin, key) => invoke("hh:attentionDismiss", plugin, key),
    read: (plugin, key) => invoke("hh:attentionRead", plugin, key),
    open: (plugin, key) => invoke("hh:attentionOpen", plugin, key),
    onChange: (listener) => subscribe("hh:attention", listener),
  },
  // Main registers these only when the harness declares secrets (D0). Only `set` sends a value; none comes back.
  connections: {
    get: () => invoke("hh:connectionsGet"),
    set: (id, value) => invoke("hh:connectionsSet", id, value),
    delete: (id) => invoke("hh:connectionsDelete", id),
    test: (id) => invoke("hh:connectionsTest", id),
    onChange: (listener) => subscribe("hh:connectionsChange", listener),
  },
  // Main registers these only when the harness declares tools (D0). The page names a tool and its arguments, never a
  // caller, task or scope.
  tools: {
    call: (id, args) => invoke("hh:toolsCall", id, args),
    trace: (id) => invoke("hh:toolsTrace", id),
    onChange: (listener) => subscribe("hh:toolsChange", listener),
  },
  // Main's board-mode inbox channels; plain mode refuses every call and never sends hh:tasksChange (D0).
  tasks: {
    list: () => invoke("hh:tasksList"),
    onChange: (listener) => subscribe("hh:tasksChange", listener),
    focus: (id) => invoke("hh:tasksFocus", id),
    cancelQueued: (id) => invoke("hh:tasksCancelQueued", id),
    resumeQueues: () => invoke("hh:tasksResume"),
  },
  // Main's jobs channels (part 3); without jobs main refuses every call and never sends hh:jobsChange (D0).
  jobs: {
    list: () => invoke("hh:jobsList"),
    run: (id, scope) => invoke("hh:jobsRun", id, scope),
    onChange: (listener) => subscribe("hh:jobsChange", listener),
  },
  setupSteps: {
    get: () => invoke("hh:setupStepsGet"),
    values: (id) => invoke("hh:setupStepValues", id),
    submit: (id, value) => invoke("hh:setupStepSubmit", id, value),
    complete: (id) => invoke("hh:setupStepComplete", id),
    skip: (id) => invoke("hh:setupStepSkip", id),
    finish: () => invoke("hh:setupStepsFinish"),
    acknowledge: () => invoke("hh:setupStepsAcknowledge"),
    onChange: (listener) => subscribe("hh:setupSteps", listener),
  },
  profiles: {
    get: () => invoke("hh:profilesGet"),
    create: (values) => invoke("hh:profileCreate", values),
    open: (id) => invoke("hh:profileOpen", id),
    archive: (id) => invoke("hh:profileArchive", id, true),
    unarchive: (id) => invoke("hh:profileArchive", id, false),
    edit: (values) => invoke("hh:profileEdit", values),
    delete: (id) => invoke("hh:profileDelete", id),
    onChange: (listener) => subscribe("hh:profiles", listener),
  },
  material: {
    list: (scope) => invoke("hh:materialList", scope),
    add: (scope) => invoke("hh:materialAdd", scope),
    addLink: (scope, url) => invoke("hh:materialAddLink", scope, url),
    confirm: (scope, id, choice) => invoke("hh:materialConfirm", scope, id, choice),
    setGrounding: (scope, mode) => invoke("hh:materialGrounding", scope, mode),
    retry: (scope, id) => invoke("hh:materialRetry", scope, id),
    decide: (scope, id, fragment, choice) => invoke("hh:materialDecide", scope, id, fragment, choice),
    remove: (scope, id) => invoke("hh:materialRemove", scope, id),
    open: (scope, id) => invoke("hh:materialOpen", scope, id),
    cite: (scope, id) => invoke("hh:materialCite", scope, id),
    onChange: (listener) => subscribe("hh:materialStatus", listener),
  },
  // The context panel (context-panel spec §5.2): every answer is data, a rejected invoke included.
  context: {
    get: (taskId) => askContext(looseInvoke, "hh:contextGet", taskId),
    onChange: (taskId, listener) => subscribe("hh:context", contextListener(taskId, listener)),
    add: (taskId, file) => askContext(looseInvoke, "hh:contextAdd", taskId, file),
    pick: () => askContext(looseInvoke, "hh:contextPick"),
    pin: (scope, file) => askContext(looseInvoke, "hh:contextPin", scope, file),
    unpin: (scope, file) => askContext(looseInvoke, "hh:contextUnpin", scope, file),
    exclude: (scope, note) => askContext(looseInvoke, "hh:contextExclude", scope, note),
    include: (scope, note) => askContext(looseInvoke, "hh:contextInclude", scope, note),
  },
  onTextSize: (listener) => subscribe("hh:textSize", listener),
  // Language on demand (language spec): every answer is data, a rejected invoke included.
  language: languageClient(looseInvoke, subscribe),
  // The harness's backend (hatches spec §4.2): main registers its channels only with `backend` (D0).
  backend: backendClient(invoke, subscribe),
  // A scope's engine config (hatches spec §5.3): main registers these channels only with `enginePresets` (D0). The
  // hash sent back is the one the view carried; main computes it again and approves only when equal.
  engineConfig: {
    get: (scope) => invoke("hh:engineConfig", scope),
    approve: (scope, hash) => invoke("hh:engineApprove", scope, hash),
    revoke: (scope) => invoke("hh:engineRevoke", scope),
    onChanged: (listener) => subscribe("hh:engineConfigChanged", listener),
  },
};

contextBridge.exposeInMainWorld("hh", client);
