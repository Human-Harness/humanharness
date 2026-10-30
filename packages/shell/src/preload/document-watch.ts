import type { InvokeChannel, PushChannel } from "@humanharness/protocol/channels";

/** The part of `ipcRenderer` the reader's watches use (a fake in the tests), on table channels only. */
export interface WatchIpc {
  on(channel: PushChannel, handler: (event: unknown, value: unknown) => void): void;
  invoke(channel: InvokeChannel, ...args: unknown[]): Promise<unknown>;
}

/** How often one subscription watches again after main ended its watch (a cap, so evictions never ping-pong). */
export const MAX_REWATCHES = 3;

interface Watch {
  file: string;
  listener: () => void;
  id: number | null;
  closed: boolean;
  rewatches: number;
}

/**
 * `HarnessClient.watchDocument` over IPC (document-reader spec §5.3). One listener per channel serves every watch,
 * by id. When main ends a watch on its own (`hh:documentWatchEnded`: the folder changed, room was made, the watcher
 * failed) the subscription watches again and the listener hears it as a change, so the reader reads again; after
 * `MAX_REWATCHES` it only tells the listener.
 */
export function documentWatcher(ipc: WatchIpc): (file: string, listener: () => void) => () => void {
  const byId = new Map<number, Watch>();
  let listening = false;

  const start = (w: Watch, again: boolean) => {
    void ipc.invoke("hh:watchDocument", w.file).then(
      (got) => {
        const id = typeof got === "number" ? got : null;
        // Unsubscribed before main answered: the watch it made goes at once.
        if (w.closed) {
          if (id !== null) void ipc.invoke("hh:unwatchDocument", id);
          return;
        }
        w.id = id;
        if (id !== null) byId.set(id, w);
        if (again) w.listener();
      },
      () => {
        if (again && !w.closed) w.listener();
      },
    );
  };

  const listen = () => {
    if (listening) return;
    listening = true;
    ipc.on("hh:documentChanged", (_e, id) => {
      if (typeof id === "number") byId.get(id)?.listener();
    });
    ipc.on("hh:documentWatchEnded", (_e, id) => {
      if (typeof id !== "number") return;
      const w = byId.get(id);
      if (!w) return;
      byId.delete(id);
      w.id = null;
      if (w.rewatches >= MAX_REWATCHES) return void w.listener();
      w.rewatches++;
      start(w, true);
    });
  };

  return (file, listener) => {
    listen();
    const w: Watch = { file, listener, id: null, closed: false, rewatches: 0 };
    start(w, false);
    return () => {
      if (w.closed) return;
      w.closed = true;
      if (w.id !== null) {
        byId.delete(w.id);
        void ipc.invoke("hh:unwatchDocument", w.id);
      }
    };
  };
}
