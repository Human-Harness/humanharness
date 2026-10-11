import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ChatLog } from "../src/main/chat-log";
import { archiveStaleChat, sessionEngine, startNewChatIfEngineChanged } from "../src/main/engine-switch";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function folderWith(engine: string | null, chat: boolean) {
  const folder = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(folder, ".harness"), { recursive: true });
  if (engine) fs.writeFileSync(path.join(folder, ".harness", "session.json"), JSON.stringify({ engine, id: "s1", started: true }));
  if (chat) await new ChatLog(folder).append({ id: "1", role: "user", text: "earlier", blocks: [], activities: [], at: "t" });
  return folder;
}

describe("startNewChatIfEngineChanged", () => {
  it("archives the chat and forgets the session when the engine changed", async () => {
    const folder = await folderWith("claude", true);
    expect(await sessionEngine(folder)).toBe("claude");
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(await new ChatLog(folder).load()).toEqual([]);
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(false);
    expect(fs.readdirSync(path.join(folder, ".harness", "chats", "archive"))).toHaveLength(1);
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBeNull();
  });

  it("keeps everything when the engine is the same or there was no session", async () => {
    const same = await folderWith("claude", true);
    expect(await startNewChatIfEngineChanged(same, "claude")).toBeNull();
    expect(await new ChatLog(same).load()).toHaveLength(1);
    const none = await folderWith(null, true);
    expect(await startNewChatIfEngineChanged(none, "codex")).toBeNull();
    expect(await new ChatLog(none).load()).toHaveLength(1);
  });

  it("stamps the engine on each saved entry", async () => {
    const folder = await folderWith(null, false);
    await new ChatLog(folder, "claude").append({ id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t" });
    expect((await new ChatLog(folder).load())[0]).toMatchObject({ engine: "claude" });
  });

  it("falls back to the last entry's engine when there is no session file", async () => {
    const folder = await folderWith(null, true);
    await new ChatLog(folder, "claude").append({ id: "2", role: "user", text: "the engine never started", blocks: [], activities: [], at: "t" });
    expect(await startNewChatIfEngineChanged(folder, "claude")).toBeNull();
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(await new ChatLog(folder).load()).toEqual([]);
  });

  it("still archives an earlier engine's chat that a failed change left behind, after the new engine has run", async () => {
    for (const session of ["codex", null]) {
      const folder = await folderWith(session, false);
      await new ChatLog(folder, "claude").append({ id: "1", role: "user", text: "with claude", blocks: [], activities: [], at: "t" });
      await new ChatLog(folder, "codex").append({ id: "2", role: "user", text: "with codex", blocks: [], activities: [], at: "t" });
      expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
      expect(await new ChatLog(folder).load()).toEqual([]);
    }
  });

  it("on load, closes the running agent when it archives a chat, so it forgets that conversation", async () => {
    const folder = await folderWith("codex", false);
    await new ChatLog(folder, "claude").append({ id: "1", role: "user", text: "with claude", blocks: [], activities: [], at: "t" });
    await new ChatLog(folder, "codex").append({ id: "2", role: "user", text: "with codex", blocks: [], activities: [], at: "t" });
    let dropped = 0;
    const dropRuntime = async () => void dropped++;
    expect(await archiveStaleChat(folder, "codex", dropRuntime)).toBe("claude");
    expect(dropped).toBe(1);
    expect(await archiveStaleChat(folder, "codex", dropRuntime)).toBeNull();
    expect(dropped).toBe(1);
  });

  it("only forgets the session when there was no chat to archive", async () => {
    const folder = await folderWith("claude", false);
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBeNull();
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(false);
  });
});
