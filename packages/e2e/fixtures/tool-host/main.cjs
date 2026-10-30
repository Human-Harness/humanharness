// The tool host probe's app (tools threat row T1): a bare Electron main that runs the real ToolHost (bundled by the
// e2e from packages/shell/src/main/tools/) on this folder's built/, laid out as the dist/ `humanharness build` writes
// (dist/ itself is ignored by git), with no harness and no app window. The e2e drives it through `app.evaluate`:
// `globalThis.probe.call(…)` runs one tool call and answers the host's answer.
const path = require("node:path");
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");

const { ToolHost, TOOL_SCHEME } = require(process.env.HH_PROBE_HOST);

// Never the default Electron profile folder: everything in the e2e's sandbox.
app.setPath("userData", process.env.HH_PROBE_USER_DATA);
protocol.registerSchemesAsPrivileged([TOOL_SCHEME]);
// No app window: the host's hidden window must not quit the app when it closes.
app.on("window-all-closed", () => {});

const ctxCalls = [];
const logs = [];

app.whenReady().then(() => {
  const host = new ToolHost({
    resources: process.env.HH_PROBE_RESOURCES,
    devTools: false,
    electron: { BrowserWindow, ipcMain, session },
    log: (message) => logs.push(message),
  });
  host.start({
    harnessId: "probe",
    dist: path.join(__dirname, "built"),
    ids: ["probe", "own"],
    // A broker that declares nothing: every ctx call is refused, as a tool with `uses: {}`.
    channel: {
      ctx: async (tool, callId, name, args) => {
        ctxCalls.push({ tool, callId, name, args });
        return { ok: false, refused: "This tool doesn't declare uses.files" };
      },
    },
  });
  globalThis.probe = { host, ctxCalls, logs, call: (c, ms) => host.call(c, ms) };
});
