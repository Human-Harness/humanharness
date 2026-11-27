import type { InvokeChannel } from "@humanharness/protocol/channels";

/** The IPC invoke on a table channel, as the helpers their tests drive with a fake take it: a channel, any arguments. */
export type Invoke = (channel: InvokeChannel, ...args: unknown[]) => Promise<unknown>;
