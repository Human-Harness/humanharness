/**
 * The app's task logic without Electron, for `humanharness run` (packages/cli): the same TaskManager,
 * TurnController, task store, usage log and engine checks the app's main process wires to its window.
 */
export { ChatLog } from "./chat-log";
export { createCommandDeps } from "./command-deps";
export * from "./data-requests";
export { type CommandDeps, engineCommand } from "./engine-command";
export { detectEngine, hasAcceptedNotice } from "./engine-status";
export { nearestTier, nextFallback, pinnedBudget, resolveProfile } from "./models";
export { resolveReferences } from "./references";
// The mod host, for `run`'s headless mods.
export { CORE_MOD_SWITCHES } from "./mods/core-mods";
export { ModHost, type Services } from "./mods/host";
export { type ResolvedMod, resolveMods } from "./mods/resolve";
export { withModAgent } from "./mods/wiring";
export { SharedConfigStore, sharedConfigDir } from "./shared-config";
export { PREPARE_FAILED, type TaskDeps, TaskManager } from "./task-manager";
export { TaskStore } from "./task-store";
export { EngineUnavailable, TurnController, type TurnOptions, memoise } from "./turn-controller";
export { type PreMeasure, type TurnKind, UsageLog, type UsageMeta, measurePre, preRecord, usageRecord } from "./usage-log";
