import { contextBridge, ipcRenderer } from "electron";
import type { HarnessClient } from "@humanharness/ui";

const client: HarnessClient = {
  getState: () => ipcRenderer.invoke("hh:getState"),
  pickFolder: (defaultPath) => ipcRenderer.invoke("hh:pickFolder", defaultPath),
  saveConfig: (patch) => ipcRenderer.invoke("hh:saveConfig", patch),
  loadChat: () => ipcRenderer.invoke("hh:loadChat"),
  send: (message) => ipcRenderer.invoke("hh:send", message),
  cancel: () => ipcRenderer.invoke("hh:cancel"),
  onEvent: (listener) => {
    const handler = (_e: unknown, event: Parameters<typeof listener>[0]) => listener(event);
    ipcRenderer.on("hh:event", handler);
    return () => ipcRenderer.removeListener("hh:event", handler);
  },
  history: () => ipcRenderer.invoke("hh:history"),
  restore: (sha) => ipcRenderer.invoke("hh:restore", sha),
};

contextBridge.exposeInMainWorld("hh", client);
