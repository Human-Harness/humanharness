// The only thing a plugin's backend window gets from the app (plugins spec §4.1, B1, B5): one function to the broker.
// The arguments cross as one JSON string (a structured clone keeps shared references; main caps and parses the text).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hh", {
  rpc: (method, args) => ipcRenderer.invoke("hh-plugin:rpc", String(method), JSON.stringify(args ?? null)),
});
