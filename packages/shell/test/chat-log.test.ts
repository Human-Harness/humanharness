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

  it("puts an answer on its block, once, rewriting the file and keeping broken lines", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new ChatLog(folder, "claude");
    await log.append({ id: "1", role: "assistant", text: "", blocks: [{ name: "commit_answer", data: { question: "q" }, id: "t1:0:0" }], activities: [], at: "t1" });
    fs.appendFileSync(path.join(folder, ".harness", "chats", "main.jsonl"), "{broken\n");
    const answer = { blockId: "t1:0:0", value: { why: "porque" }, answeredAt: "2026-10-25T10:00:00.000Z" };
    expect(await log.markAnswered(answer)).toBe(true);
    expect(await log.markAnswered(answer)).toBe(false);
    expect(await log.markAnswered({ ...answer, blockId: "t9:0:0" })).toBe(false);
    const [entry] = await log.load();
    expect(entry.blocks[0]).toEqual({ name: "commit_answer", data: { question: "q" }, id: "t1:0:0", input: answer });
    expect(entry.engine).toBe("claude");
    expect(fs.readFileSync(path.join(folder, ".harness", "chats", "main.jsonl"), "utf8")).toContain("{broken\n");
  });

  it("an id survives the recorder", () => {
    const r = new TurnRecorder(new Set());
    r.add({ type: "block", name: "commit_answer", data: { question: "q" }, id: "t1:0:0" });
    r.add({ type: "block", name: "card", data: {} });
    expect(r.finish({ type: "done", ok: true }).blocks).toEqual([
      { name: "commit_answer", data: { question: "q" }, id: "t1:0:0" },
      { name: "card", data: {} },
    ]);
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

  it("keeps the turn's first limits snapshot apart from the last one, which goes on the reply", () => {
    const r = new TurnRecorder(new Set());
    const first = [{ kind: "five_hour", utilization: 0.3, resetsAt: "2026-10-11T15:00:00.000Z" }];
    const last = [{ kind: "five_hour", utilization: 0.36, resetsAt: "2026-10-11T15:00:00.000Z" }];
    expect(r.firstLimits).toBeUndefined();
    r.add({ type: "limits", status: "allowed", windows: first });
    r.add({ type: "limits", status: "allowed", windows: last });
    expect(r.firstLimits).toEqual(first);
    const entry = r.finish({ type: "done", ok: true });
    expect(entry.limits).toEqual(last);
    expect("firstLimits" in entry).toBe(false);
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

describe("a chat per scope", () => {
  it("writes each scope's chat to its own file and lists them", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    const entry = (id: string) => ({ id, role: "user" as const, text: id, blocks: [], activities: [], at: "t" });
    await new ChatLog(folder).append(entry("m"));
    await new ChatLog(folder, "claude", "fracciones").append(entry("f"));
    await new ChatLog(folder, undefined, "_app").append(entry("a"));
    expect((await new ChatLog(folder, undefined, "fracciones").load()).map((e) => e.id)).toEqual(["f"]);
    expect((await new ChatLog(folder).load()).map((e) => e.id)).toEqual(["m"]);
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "fracciones.jsonl"))).toBe(true);
    expect(await ChatLog.scopesIn(folder)).toEqual(["_app", "fracciones", "main"]);
    expect(await new ChatLog(folder, undefined, "fracciones").archive("claude")).toMatch(/-fracciones-claude\.jsonl$/);
    expect(await ChatLog.scopesIn(folder)).toEqual(["_app", "main"]);
    expect(() => new ChatLog(folder, undefined, "../x")).toThrow(/scope/);
    fs.rmSync(folder, { recursive: true, force: true });
  });
});
