// The events a turn streams to the window and the cards built from them: defined with the transport contract in
// @humanharness/engines (replaceable parts §4.4) and re-exported here so the UI imports no engine package.
export type { ActivityKind, DocumentCard, EngineError, Event, LimitWindow, TaskNotice, ToolCallView } from "@humanharness/engines";
