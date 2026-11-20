// Sidekick's names for the generic engine session moved to the Sidekick core mod (packages/mods/sidekick/src/session.ts);
// these keep the core's call sites until they go.
export { EngineSession as SidekickSession, type EngineAnswer as SidekickAnswer, type EngineSessionOptions as SidekickSessionOptions } from "./engine-session";
