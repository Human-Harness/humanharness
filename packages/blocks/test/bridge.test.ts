import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type BlockMessage, openBridge, sendToBridge } from "../src";

function rawExchange(socketPath: string, lines: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const answers: string[] = [];
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(lines.map((l) => l + "\n").join("")));
    socket.on("data", (c: string) => {
      buf += c;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      answers.push(...parts);
      if (answers.length >= lines.length) {
        socket.end();
        resolve(answers);
      }
    });
    socket.on("error", reject);
  });
}

describe("bridge", () => {
  it("delivers block messages in order", async () => {
    const received: BlockMessage[] = [];
    const bridge = await openBridge((m) => received.push(m));
    await sendToBridge(bridge, { name: "note", data: { title: "a" } });
    await sendToBridge(bridge, { name: "progress", data: { percent: 5 } });
    await bridge.close();
    expect(received).toEqual([
      { name: "note", data: { title: "a" } },
      { name: "progress", data: { percent: 5 } },
    ]);
  });

  it("rejects when nobody is listening", async () => {
    const bridge = await openBridge(() => {});
    await bridge.close();
    await expect(sendToBridge(bridge, { name: "note", data: {} })).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("keeps the socket in a private directory removed on close", async () => {
    const bridge = await openBridge(() => {});
    const dir = path.dirname(bridge.path);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    await bridge.close();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("rejects and does not deliver a message with the wrong token", async () => {
    const received: BlockMessage[] = [];
    const bridge = await openBridge((m) => received.push(m));
    await expect(sendToBridge({ path: bridge.path, token: "wrong" }, { name: "note", data: {} })).rejects.toThrow();
    await bridge.close();
    expect(received).toEqual([]);
  });

  it("answers error to a malformed line and still delivers the next message", async () => {
    const received: BlockMessage[] = [];
    const bridge = await openBridge((m) => received.push(m));
    const good = JSON.stringify({ token: bridge.token, name: "note", data: { x: 1 } });
    const answers = await rawExchange(bridge.path, ["not json", JSON.stringify({ token: bridge.token, name: 5 }), good]);
    await bridge.close();
    expect(answers).toEqual(["error", "error", "ok"]);
    expect(received).toEqual([{ name: "note", data: { x: 1 } }]);
  });

  it("answers error when the handler throws and keeps working", async () => {
    let calls = 0;
    const bridge = await openBridge(() => {
      if (calls++ === 0) throw new Error("boom");
    });
    await expect(sendToBridge(bridge, { name: "a", data: {} })).rejects.toThrow();
    await sendToBridge(bridge, { name: "b", data: {} });
    await bridge.close();
  });
});
