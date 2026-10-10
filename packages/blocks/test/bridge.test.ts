import { describe, expect, it } from "vitest";
import { type BlockMessage, openBridge, sendToBridge } from "../src";

describe("bridge", () => {
  it("delivers block messages in order", async () => {
    const received: BlockMessage[] = [];
    const bridge = await openBridge((m) => received.push(m));
    await sendToBridge(bridge.path, { name: "note", data: { title: "a" } });
    await sendToBridge(bridge.path, { name: "progress", data: { percent: 5 } });
    await bridge.close();
    expect(received).toEqual([
      { name: "note", data: { title: "a" } },
      { name: "progress", data: { percent: 5 } },
    ]);
  });

  it("rejects when nobody is listening", async () => {
    const bridge = await openBridge(() => {});
    await bridge.close();
    await expect(sendToBridge(bridge.path, { name: "note", data: {} })).rejects.toThrow();
  });
});
