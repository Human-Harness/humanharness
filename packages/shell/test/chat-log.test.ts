import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ChatLog, TurnRecorder } from "../src/main/chat-log";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("TurnRecorder", () => {
  it("builds the assistant entry from runtime events", () => {
    const r = new TurnRecorder(new Set(["progress"]));
    r.add({ type: "text", delta: "Hello" });
    r.add({ type: "activity", id: "a", kind: "edit", detail: "x.md", state: "start" });
    r.add({ type: "paragraph" });
    r.add({ type: "text", delta: "Done" });
    r.add({ type: "block", name: "note", data: { title: "T" } });
    r.add({ type: "block", name: "progress", data: { percent: 5 } });
    const entry = r.finish({ type: "done", ok: true });
    expect(entry).toMatchObject({
      role: "assistant",
      text: "Hello\n\nDone",
      blocks: [{ name: "note", data: { title: "T" } }],
      activities: [{ kind: "edit", detail: "x.md" }],
    });
    expect(entry.error).toBeUndefined();
  });

  it("records the error of a failed turn", () => {
    const r = new TurnRecorder(new Set());
    expect(r.finish({ type: "done", ok: false, error: { code: "agent-crashed" } }).error).toEqual({ code: "agent-crashed" });
  });
});

describe("ChatLog", () => {
  it("appends and loads entries in order", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new ChatLog(folder);
    await log.append({ id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t1" });
    await log.append({ id: "2", role: "assistant", text: "hello", blocks: [], activities: [], at: "t2" });
    expect((await new ChatLog(folder).load()).map((e) => e.text)).toEqual(["hi", "hello"]);
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "main.jsonl"))).toBe(true);
  });

  it("skips broken lines and returns the last N", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    fs.mkdirSync(path.join(folder, ".harness", "chats"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, ".harness", "chats", "main.jsonl"),
      ['{"id":"1","role":"user","text":"a","blocks":[],"activities":[],"at":"t"}', "{broken", '{"id":"2","role":"user","text":"b","blocks":[],"activities":[],"at":"t"}'].join("\n") + "\n",
    );
    expect((await new ChatLog(folder).load(1)).map((e) => e.text)).toEqual(["b"]);
  });
});

describe("TurnRecorder usage", () => {
  it("keeps tokens, limits and the latest state blocks on the reply", () => {
    const r = new TurnRecorder(new Set(["progress"]));
    const windows = [{ kind: "five_hour", utilization: 0.3, resetsAt: "2026-10-11T15:00:00.000Z" }];
    r.add({ type: "block", name: "progress", data: { percent: 10 } });
    r.add({ type: "block", name: "progress", data: { percent: 40 } });
    r.add({ type: "limits", status: "allowed", windows });
    r.add({ type: "usage", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costEquivalentUsd: 0.5 });
    expect(r.finish({ type: "done", ok: true })).toMatchObject({
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      limits: windows,
      state: { progress: { percent: 40 } },
    });
  });

  it("adds nothing when the engine reported nothing", () => {
    const entry = new TurnRecorder(new Set()).finish({ type: "done", ok: true });
    expect("usage" in entry || "limits" in entry || "state" in entry).toBe(false);
  });
});

describe("ChatLog.archive", () => {
  it("moves the conversation to chats/archive and starts empty", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new ChatLog(folder);
    await log.append({ id: "1", role: "user", text: "hi", blocks: [], activities: [], at: "t1" });
    const target = await log.archive("claude");
    expect(target).toMatch(/\.harness\/chats\/archive\/.+-claude\.jsonl$/);
    expect(fs.readFileSync(target!, "utf8")).toContain('"hi"');
    expect(await log.load()).toEqual([]);
  });

  it("does nothing when there is no conversation", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    expect(await new ChatLog(folder).archive("claude")).toBeNull();
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "archive"))).toBe(false);
  });
});
