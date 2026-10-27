import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ChatLog } from "../src/main/chat-log";
import { archiveChatsOnEngineChange, archiveStaleChat, sessionEngine, startNewChatIfEngineChanged } from "../src/main/engine-switch";

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

  it("archives every scope's chat", async () => {
    const folder = await folderWith("claude", true);
    await new ChatLog(folder, undefined, "fracciones").append({ id: "2", role: "user", text: "x", blocks: [], activities: [], at: "t" });
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(await ChatLog.scopesIn(folder)).toEqual([]);
    expect(fs.readdirSync(path.join(folder, ".harness", "chats", "archive"))).toHaveLength(2);
  });

  it("finds the previous engine in any scope's chat", async () => {
    const folder = await folderWith(null, false);
    await new ChatLog(folder, "claude", "fracciones").append({ id: "2", role: "user", text: "x", blocks: [], activities: [], at: "t" });
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
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

describe("engine switch with tasks", () => {
  it("reads the engine from tasks.json, archives the chat, ends the open task and keeps the notes", async () => {
    const folder = await folderWith(null, true);
    fs.writeFileSync(
      path.join(folder, ".harness", "tasks.json"),
      JSON.stringify({
        version: 1,
        engine: "claude",
        current: { id: "t1", action: "turn", status: "waiting", startedAt: "t", turns: 1 },
        actions: { manifest: "done" },
      }),
    );
    fs.mkdirSync(path.join(folder, ".harness", "notes"));
    fs.writeFileSync(path.join(folder, ".harness", "notes", "manifest.md"), "---\ntitle: \"M\"\n---\n");
    expect(await sessionEngine(folder)).toBe("claude");
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"))).toEqual({
      version: 1,
      current: null,
      actions: { manifest: "done", turn: "unfinished" },
    });
    expect(fs.existsSync(path.join(folder, ".harness", "notes", "manifest.md"))).toBe(true);
    expect(await sessionEngine(folder)).toBeNull();
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBeNull();
  });
});

describe("archiveChatsOnEngineChange (profiles spec §5 'Engine switch')", () => {
  it("archives the active profile's chat and every other one's, answering the active one's engine", async () => {
    const sofi = await folderWith("claude", true);
    const tomas = await folderWith("claude", true);
    expect(await archiveChatsOnEngineChange(sofi, [tomas], "codex")).toBe("claude");
    expect(await new ChatLog(sofi).load()).toEqual([]);
    expect(await new ChatLog(tomas).load()).toEqual([]);
    expect(fs.readdirSync(path.join(tomas, ".harness", "chats", "archive"))).toHaveLength(1);
  });

  it("another profile that can't be read is logged; the active one still starts over", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sofi = await folderWith("claude", true);
    const broken = await folderWith("claude", true);
    fs.chmodSync(path.join(broken, ".harness"), 0o000);
    try {
      expect(await archiveChatsOnEngineChange(sofi, [broken], "codex")).toBe("claude");
    } finally {
      fs.chmodSync(path.join(broken, ".harness"), 0o755);
    }
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
