import type { InvokeArgs, InvokeChannel, InvokeResult, Push, PushChannel } from "@humanharness/protocol/channels";
import { ipcRenderer } from "electron";

/** `ipcRenderer.invoke` on a table channel (replaceable parts §5.3): typed arguments and answer. */
export function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args);
}

/** Listens on a table push channel; returns the unsubscribe. */
export function subscribe<C extends PushChannel>(channel: C, listener: (value: Push[C]) => void): () => void {
  const handler = (_e: unknown, value: Push[C]) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
