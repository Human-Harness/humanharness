import { contextBridge, ipcRenderer } from "electron";
import type { Event, HarnessClient, SetupOutput, TaskView } from "@humanharness/ui/client";

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
  history: () => ipcRenderer.invoke("hh:history"),
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
  getTasks: () => ipcRenderer.invoke("hh:getTasks"),
  onTasks: (listener) => subscribe<TaskView>("hh:tasks", listener),
  choose: (option, task) => ipcRenderer.invoke("hh:choose", option, task),
  openPath: (file) => ipcRenderer.invoke("hh:openPath", file),
  revealPath: (file) => ipcRenderer.invoke("hh:revealPath", file),
};

contextBridge.exposeInMainWorld("hh", client);
