// The only thing the tool host window gets from the app (tools spec §4.1, T1, T2): one function to main's tool host.
// The arguments cross as one JSON string (a structured clone keeps shared references; main caps and parses the text).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hh", {
  rpc: (method, args) => ipcRenderer.invoke("hh-tools:rpc", String(method), JSON.stringify(args ?? null)),
});
