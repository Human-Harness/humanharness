import { describe, expect, it } from "vitest";
import { MAX_REWATCHES, type WatchIpc, documentWatcher } from "../src/preload/document-watch";

/** A fake ipcRenderer: main hands out ids in order; `emit` plays a message from main. */
function fakeIpc() {
  const handlers = new Map<string, ((e: unknown, v: unknown) => void)[]>();
  const calls: [string, unknown][] = [];
  let next = 1;
  const ipc: WatchIpc & { calls: typeof calls; emit(channel: string, v: unknown): void; listeners(channel: string): number } = {
    calls,
    on: (channel, handler) => handlers.set(channel, [...(handlers.get(channel) ?? []), handler]),
    invoke: async (channel, arg) => {
      calls.push([channel, arg]);
      return channel === "hh:watchDocument" ? next++ : undefined;
    },
    emit: (channel, v) => {
      for (const h of handlers.get(channel) ?? []) h(null, v);
    },
    listeners: (channel) => handlers.get(channel)?.length ?? 0,
  };
  return ipc;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("documentWatcher (document-reader spec §5.3)", () => {
  it("uses one listener per channel for every watch and tells each listener only of its own id", async () => {
    const ipc = fakeIpc();
    const watch = documentWatcher(ipc);
    const heard: string[] = [];
    for (let i = 0; i < 20; i++) watch(`d${i}.md`, () => heard.push(`d${i}`));
    await settle();
    expect(ipc.listeners("hh:documentChanged")).toBe(1);
    expect(ipc.listeners("hh:documentWatchEnded")).toBe(1);
    ipc.emit("hh:documentChanged", 3);
    ipc.emit("hh:documentChanged", "3");
    ipc.emit("hh:documentChanged", 99);
    expect(heard).toEqual(["d2"]);
  });

  it("unwatches on unsubscribe, also when main answers after it", async () => {
    const ipc = fakeIpc();
    const watch = documentWatcher(ipc);
    const early = watch("a.md", () => undefined);
    early();
    await settle();
    const late = watch("b.md", () => undefined);
    await settle();
    late();
    late();
    expect(ipc.calls.filter(([c]) => c === "hh:unwatchDocument")).toEqual([
      ["hh:unwatchDocument", 1],
      ["hh:unwatchDocument", 2],
    ]);
  });

  it("watches again when main ends a watch, and the listener hears it as a change", async () => {
    const ipc = fakeIpc();
    const watch = documentWatcher(ipc);
    let heard = 0;
    watch("a.md", () => heard++);
    await settle();
    ipc.emit("hh:documentWatchEnded", 1);
    await settle();
    expect(ipc.calls.filter(([c]) => c === "hh:watchDocument")).toHaveLength(2);
    expect(heard).toBe(1);
    // The new id is live; the old one is not.
    ipc.emit("hh:documentChanged", 1);
    ipc.emit("hh:documentChanged", 2);
    expect(heard).toBe(2);
  });

  it(`stops watching again after ${MAX_REWATCHES} ends and only tells the listener`, async () => {
    const ipc = fakeIpc();
    const watch = documentWatcher(ipc);
    let heard = 0;
    watch("a.md", () => heard++);
    await settle();
    for (let id = 1; id <= MAX_REWATCHES + 1; id++) {
      ipc.emit("hh:documentWatchEnded", id);
      await settle();
    }
    expect(ipc.calls.filter(([c]) => c === "hh:watchDocument")).toHaveLength(MAX_REWATCHES + 1);
    expect(heard).toBe(MAX_REWATCHES + 1);
  });

  it("ignores an end for an id it does not hold or after unsubscribing", async () => {
    const ipc = fakeIpc();
    const watch = documentWatcher(ipc);
    let heard = 0;
    const off = watch("a.md", () => heard++);
    await settle();
    ipc.emit("hh:documentWatchEnded", 7);
    off();
    ipc.emit("hh:documentWatchEnded", 1);
    await settle();
    expect(heard).toBe(0);
    expect(ipc.calls.filter(([c]) => c === "hh:watchDocument")).toHaveLength(1);
  });
});
