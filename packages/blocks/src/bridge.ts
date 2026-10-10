import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
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
  /** Secret the sender must include in every message. */
  token: string;
  close(): Promise<void>;
}

const MAX_SOCKET_PATH_BYTES = 100;
const MAX_BUFFERED_CHARS = 1_000_000;

/** Private (0700) directory holding the socket, so other local users cannot connect. */
function makePrivateDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
  if (Buffer.byteLength(path.join(dir, "bridge.sock")) > MAX_SOCKET_PATH_BYTES) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = fs.mkdtempSync(path.join("/tmp", "hh-"));
  }
  fs.chmodSync(dir, 0o700);
  return dir;
}

/** Local channel from the `ui` MCP server (a child of the agent) back to the runtime. Newline-delimited JSON. */
export async function openBridge(onMessage: (message: BlockMessage) => void): Promise<Bridge> {
  const token = randomBytes(16).toString("hex");
  const dir = process.platform === "win32" ? undefined : makePrivateDir();
  const bridgePath = dir ? path.join(dir, "bridge.sock") : `\\\\.\\pipe\\hh-${randomUUID().slice(0, 8)}`;
  const cleanup = () => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  };

  const handleLine = (line: string): boolean => {
    let parsed: { token?: unknown; name?: unknown; data?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.name !== "string") return false;
    if (parsed.token !== token) return false;
    try {
      onMessage({ name: parsed.name, data: parsed.data });
    } catch {
      return false;
    }
    return true;
  };

  const server = net.createServer((socket) => {
    let rest = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (chunk: string) => {
      rest += chunk;
      let i: number;
      while ((i = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, i);
        rest = rest.slice(i + 1);
        socket.write(handleLine(line) ? "ok\n" : "error\n");
      }
      if (rest.length > MAX_BUFFERED_CHARS) socket.destroy();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(bridgePath, () => resolve());
    });
  } catch (e) {
    cleanup();
    throw e;
  }
  return {
    path: bridgePath,
    token,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          cleanup();
          resolve();
        }),
      ),
  };
}

export function sendToBridge(
  bridge: { path: string; token: string },
  message: BlockMessage,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(bridge.path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Bridge timeout"));
    }, timeoutMs);
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify({ token: bridge.token, ...message }) + "\n"));
    socket.on("data", (chunk: string) => {
      answer += chunk;
      if (!answer.includes("\n")) return;
      clearTimeout(timer);
      socket.end();
      if (answer.trim() === "ok") resolve();
      else reject(new Error("Bridge rejected the message"));
    });
    socket.on("close", () => {
      clearTimeout(timer);
      reject(new Error("Bridge closed without an answer"));
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
