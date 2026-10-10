import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface BlockMessage {
  name: string;
  data: unknown;
}

export interface Bridge {
  /** Unix socket path (or Windows named pipe) the `ui` MCP server writes to. */
  path: string;
  close(): Promise<void>;
}

function newBridgePath(): string {
  const id = randomUUID().slice(0, 8);
  return process.platform === "win32" ? `\\\\.\\pipe\\hh-${id}` : path.join(os.tmpdir(), `hh-${id}.sock`);
}

/** Local channel from the `ui` MCP server (a child of the agent) back to the runtime. Newline-delimited JSON. */
export async function openBridge(onMessage: (message: BlockMessage) => void): Promise<Bridge> {
  const bridgePath = newBridgePath();
  const server = net.createServer((socket) => {
    let rest = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      rest += chunk;
      let i: number;
      while ((i = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, i);
        rest = rest.slice(i + 1);
        try {
          onMessage(JSON.parse(line) as BlockMessage);
          socket.write("ok\n");
        } catch {
          socket.write("error\n");
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bridgePath, () => resolve());
  });
  return {
    path: bridgePath,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function sendToBridge(bridgePath: string, message: BlockMessage, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(bridgePath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Bridge timeout"));
    }, timeoutMs);
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(message) + "\n"));
    socket.on("data", (chunk: string) => {
      answer += chunk;
      if (!answer.includes("\n")) return;
      clearTimeout(timer);
      socket.end();
      if (answer.startsWith("ok")) resolve();
      else reject(new Error("Bridge rejected the message"));
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
