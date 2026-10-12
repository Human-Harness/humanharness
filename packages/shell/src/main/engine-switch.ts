import { promises as fs } from "node:fs";
import path from "node:path";
import { ChatLog } from "./chat-log";
import { TaskStore } from "./task-store";

const sessionFile = (folder: string) => path.join(folder, ".harness", "session.json");

/** The engine that ran the folder's last task (tasks.json), or of a plan 2 session.json, if any. */
export async function sessionEngine(folder: string): Promise<string | null> {
  const tasks = await new TaskStore(folder).load();
  if (tasks.engine) return tasks.engine;
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
  // The session file names the engine that ran last. When it is this one (or there is none), the
  // chat itself tells: any entry from another engine (an earlier change that couldn't archive it,
  // or an engine that never started a session) means it belongs to that conversation.
  const session = await sessionEngine(folder);
  const previous =
    (session && session !== engineId ? session : null) ?? (await new ChatLog(folder).load()).find((e) => e.engine && e.engine !== engineId)?.engine ?? null;
  if (!previous || previous === engineId) return null;
  const archived = await new ChatLog(folder).archive(previous);
  await fs.rm(sessionFile(folder), { force: true });
  // The open task can't continue on another engine; the notes stay.
  await new TaskStore(folder).forgetEngine();
  return archived ? previous : null;
}

/**
 * For a chat load: archives a chat that belongs to another engine (see startNewChatIfEngineChanged)
 * and then closes the running agent, whose session still holds the archived conversation; the next
 * turn starts a fresh one. Returns the archived chat's engine.
 */
export async function archiveStaleChat(folder: string, engineId: string, dropRuntime: () => Promise<void>): Promise<string | null> {
  const archived = await startNewChatIfEngineChanged(folder, engineId);
  if (archived) await dropRuntime();
  return archived;
}
