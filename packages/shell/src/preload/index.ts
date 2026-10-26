import { contextBridge, ipcRenderer } from "electron";
import type { DataChangeView, Event, HarnessClient, ScopesView, SettingsState, SetupOutput, TaskView, TextSize } from "@humanharness/ui/client";
import { hearsDataChange } from "@humanharness/ui/data-change";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

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
  openTerminal: () => ipcRenderer.invoke("hh:openTerminal"),
  resetSharedConfig: () => ipcRenderer.invoke("hh:resetSharedConfig"),
  getUsage: () => ipcRenderer.invoke("hh:getUsage"),
  revealFolder: () => ipcRenderer.invoke("hh:revealFolder"),
  moveFolder: (to) => ipcRenderer.invoke("hh:moveFolder", to),
  getTasks: () => ipcRenderer.invoke("hh:getTasks"),
  onTasks: (listener) => subscribe<TaskView>("hh:tasks", listener),
  choose: (option, task) => ipcRenderer.invoke("hh:choose", option, task),
  respond: (blockId, value) => ipcRenderer.invoke("hh:respond", blockId, value),
  chooseMode: (mode, choice) => ipcRenderer.invoke("hh:chooseMode", mode, choice ?? {}),
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
  onTextSize: (listener) => subscribe<TextSize>("hh:textSize", listener),
};

contextBridge.exposeInMainWorld("hh", client);
