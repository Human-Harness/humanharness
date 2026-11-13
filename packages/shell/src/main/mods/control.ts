import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { LayoutView, ModRow } from "@humanharness/protocol";

/**
 * The control channel (minimal-core spec §5.4): how `humanharness status` and `humanharness shot` reach the running
 * app. An HTTP server on 127.0.0.1, a random port; every request needs the token in `.control.json`, which only the
 * person can read (mode 0600) and which goes away on quit.
 */
export const CONTROL_FILE = ".control.json";
export interface ControlFile {
  port: number;
  token: string;
  pid: number;
}
/** `GET /status`: the mods as Settings › Mods lists them, the folders that couldn't be read, and the layout shown. */
export interface ControlStatus {
  mods: ModRow[];
  problems: { id: string; reason: string }[];
  layout: Pick<LayoutView, "name" | "source" | "problems">;
}
/** What `POST /shot` needs of the window. */
export interface ShotWindow {
  webContents: { capturePage(): Promise<{ toPNG(): Buffer }> };
}

const MAX_BODY = 64 * 1024;
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "The request is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // Falls through to the 400.
  }
  throw new HttpError(400, "The body must be a JSON object");
}

/** Starts the server and writes `<home>/.control.json`; `stop` closes it and removes the file. */
export async function startControl(d: {
  home: string;
  window: () => ShotWindow | null;
  status: () => Promise<ControlStatus>;
}): Promise<{ port: number; stop(): Promise<void> }> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req: IncomingMessage) => {
    const got = Buffer.from(req.headers.authorization ?? "");
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const shot = async (req: IncomingMessage): Promise<{ path: string }> => {
    const body = await readJson(req);
    if (body.path !== undefined && (typeof body.path !== "string" || !path.isAbsolute(body.path))) throw new HttpError(400, "path must be an absolute file path");
    const win = d.window();
    if (!win) throw new HttpError(409, "The app has no window to capture");
    const file = typeof body.path === "string" ? body.path : path.join(d.home, "shots", `${stamp()}.png`);
    const png = (await win.webContents.capturePage()).toPNG();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, png);
    return { path: file };
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!authorized(req)) return send(res, 401, { error: "A valid token is needed" });
        const route = (req.url ?? "").split("?")[0];
        if (req.method === "GET" && route === "/status") return send(res, 200, await d.status());
        if (req.method === "POST" && route === "/shot") return send(res, 200, await shot(req));
        return send(res, 404, { error: "Not found" });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        console.error("The control channel failed", err);
        return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const file = path.join(d.home, CONTROL_FILE);
  const content: ControlFile = { port, token, pid: process.pid };
  await fs.mkdir(d.home, { recursive: true });
  // Removed first, so an older file (another mode, another owner's write) never keeps its permissions.
  await fs.rm(file, { force: true });
  await fs.writeFile(file, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.chmod(file, 0o600);

  let stopped = false;
  return {
    port,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // Only our own file: another run of the app may have written its own since.
      const now = await fs.readFile(file, "utf8").catch(() => "");
      if (now.includes(`"${token}"`)) await fs.rm(file, { force: true });
    },
  };
}
