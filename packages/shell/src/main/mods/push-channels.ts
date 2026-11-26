import type { PushChannel } from "@humanharness/protocol/channels";

/** A push channel's name without its `hh:` prefix. */
type Bare = { [K in PushChannel]: K extends `hh:${infer N}` ? N : never }[PushChannel];

/**
 * Every channel main pushes to the window (the protocol's `Push`), without the `hh:` prefix: the type keeps this list
 * whole, both ways. Bare names, so the surface tests that look for a hatch's channel literals in main still hold.
 */
const ALL: Record<Bare, boolean> = {
  event: true,
  setupOutput: true,
  tasks: true,
  taskTurn: true,
  reviewChanged: true,
  fileCommits: true,
  documentChanged: true,
  documentWatchEnded: true,
  scopes: true,
  dataChange: true,
  settings: true,
  modsChanged: true,
  layoutChanged: true,
  modReloaded: true,
  // A mod's own push (`ModHost.pusher`), with its id set by main: never one a core mod names itself.
  modPush: false,
  homeHistoryChanged: true,
  safeModeEntered: true,
  plugins: true,
  pluginSurface: true,
  pluginData: true,
  attention: true,
  connectionsChange: true,
  toolsChange: true,
  tasksChange: true,
  jobsChange: true,
  setupSteps: true,
  profiles: true,
  materialStatus: true,
  context: true,
  searchStatus: true,
  textSize: true,
  language: true,
  backendEvent: true,
  backendStateChange: true,
  engineConfigChanged: true,
};

/** The app's push channels: the only ones a core mod's `ctx.push` may use. */
export const PUSH_CHANNELS: ReadonlySet<string> = new Set(
  Object.entries(ALL)
    .filter(([, ok]) => ok)
    .map(([n]) => `hh:${n}`),
);

export const isPushChannel = (name: unknown): name is PushChannel => typeof name === "string" && PUSH_CHANNELS.has(name);
