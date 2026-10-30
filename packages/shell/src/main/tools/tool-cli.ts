/**
 * `@humanharness/shell/tools`: the CLI's way into the very registry, broker and trace the app runs (`humanharness tool
 * test`, `tool run`, `run`), so a tool is checked the same way on the author's machine. Nothing here imports Electron or
 * node:vm (a test pins the whole import graph); the CLI brings its own host (tool-host-node.ts).
 */
export { ToolRegistry, type ToolAnswer, type ToolCall, type ToolCaller, type ToolRegistryDeps } from "./tool-registry";
export { ToolBroker, type ToolBrokerDeps, TOOL_CALLS } from "./tool-broker";
export { ToolTrace, type TraceEntry } from "./tool-trace";
export { toolFiles, type ToolFiles } from "./tool-files";
export { runPreSteps, runToolStep, type StepRegistry, type StepResult } from "./pre-steps";
export { preparedSection, type PreparedPart } from "./prepared-section";
export { readToolsJson, type ToolsState } from "./tools-json";
export { readToolFixtures } from "./tool-fixture-files";
export { recordedToolTransport, readToolRecordings } from "./recorded-transport";
export { prepareTask, type PrepareTaskDeps, type PreparedTask, type PreRowFields } from "./prepare-task";
