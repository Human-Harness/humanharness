import type { PushChannel } from "@humanharness/protocol/channels";

/** Every channel main pushes to the window (the protocol's `Push`): the type keeps this list whole, both ways. */
const ALL: Record<PushChannel, true> = {
  "hh:event": true,
  "hh:setupOutput": true,
  "hh:tasks": true,
  "hh:taskTurn": true,
  "hh:reviewChanged": true,
  "hh:fileCommits": true,
  "hh:documentChanged": true,
  "hh:documentWatchEnded": true,
  "hh:scopes": true,
  "hh:dataChange": true,
  "hh:settings": true,
  "hh:sidekick": true,
  "hh:modsChanged": true,
  "hh:layoutChanged": true,
  "hh:modReloaded": true,
  "hh:homeHistoryChanged": true,
  "hh:safeModeEntered": true,
  "hh:plugins": true,
  "hh:pluginSurface": true,
  "hh:pluginData": true,
  "hh:attention": true,
  "hh:connectionsChange": true,
  "hh:toolsChange": true,
  "hh:tasksChange": true,
  "hh:jobsChange": true,
  "hh:setupSteps": true,
  "hh:profiles": true,
  "hh:materialStatus": true,
  "hh:context": true,
  "hh:searchStatus": true,
  "hh:textSize": true,
  "hh:language": true,
  "hh:backendEvent": true,
  "hh:backendStateChange": true,
  "hh:engineConfigChanged": true,
};

/** The app's push channels: the only ones a core mod's `ctx.push` may use. */
export const PUSH_CHANNELS: ReadonlySet<string> = new Set(Object.keys(ALL));

export const isPushChannel = (name: unknown): name is PushChannel => typeof name === "string" && PUSH_CHANNELS.has(name);
