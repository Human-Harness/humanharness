/**
 * `@humanharness/shell/plugins`: the CLI's way into the very broker the app runs (`humanharness plugin record` and
 * `test`, plugins Decision 20–21), so a plugin is checked the same way on the author's machine. Nothing here imports
 * Electron (a test pins the whole import graph).
 */
export { BROKER_CALLS, BROKER_LIMITS, type BrokerAnswer, type BrokerDataOp, type BrokerDeps, PluginBroker, type PluginAttentionInput } from "./plugin-broker";
export { PluginData } from "./plugin-data";
export { type ExecOutcome, type ExecResult, pluginExec, runFile } from "./plugin-exec";
export { type FetchOutcome, type FetchRequest, type FetchedResponse, pluginFetch } from "./plugin-fetch";
export { fixtureTransport } from "@humanharness/harness-sdk/plugin-fixtures";
export { isPublicHost } from "./material-fetch";
