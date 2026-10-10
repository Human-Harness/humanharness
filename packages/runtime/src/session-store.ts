import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Session } from "./transport";

const file = (folder: string) => path.join(folder, ".harness", "session.json");

export async function readSession(folder: string, engineId: string): Promise<Session> {
  try {
    const saved = JSON.parse(await fs.readFile(file(folder), "utf8")) as Session & { engine: string };
    if (saved.engine === engineId) return { id: saved.id, started: saved.started };
  } catch {
    // no session yet
  }
  return { id: randomUUID(), started: false };
}

export async function writeSession(folder: string, engineId: string, session: Session): Promise<void> {
  await fs.mkdir(path.dirname(file(folder)), { recursive: true });
  await fs.writeFile(file(folder), JSON.stringify({ engine: engineId, ...session }));
}
