import { promises as fs } from "node:fs";
import path from "node:path";
import { ChatLog } from "./chat-log";

const sessionFile = (folder: string) => path.join(folder, ".harness", "session.json");

/** The engine of the folder's saved agent session (written by the runtime), if any. */
export async function sessionEngine(folder: string): Promise<string | null> {
  try {
    const saved = JSON.parse(await fs.readFile(sessionFile(folder), "utf8")) as { engine?: unknown };
    return typeof saved.engine === "string" ? saved.engine : null;
  } catch {
    return null;
  }
}

/**
 * A new engine can't continue another engine's session, so the conversation starts over: the chat
 * moves to `chats/archive/` and the old session is forgotten. Returns the previous engine id when
 * a chat was archived.
 */
export async function startNewChatIfEngineChanged(folder: string, engineId: string): Promise<string | null> {
  const previous = await sessionEngine(folder);
  if (!previous || previous === engineId) return null;
  const archived = await new ChatLog(folder).archive(previous);
  await fs.rm(sessionFile(folder), { force: true });
  return archived ? previous : null;
}
