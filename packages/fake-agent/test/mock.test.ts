import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadRecordings, recordingSchema } from "../src/mock";
import { mockSidekickReply, runMockTurn } from "../src/mock-claude";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mock-schema-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const minimal = { version: 1, action: "manifest", match: "# Topic: the manifest", turns: [{ id: "t1", text: "Hola." }] };

describe("recordingSchema", () => {
  it("fills defaults on a minimal recording", () => {
    const r = recordingSchema.parse(minimal);
    expect(r.turns[0]).toEqual({ id: "t1", text: "Hola.", blocks: [], writes: [] });
  });

  it("rejects a write that leaves the folder", () => {
    for (const p of ["../x", "/etc/x", "a/../../x"]) {
      const bad = { ...minimal, turns: [{ id: "t1", writes: [{ path: p, content: "x" }] }] };
      expect(recordingSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects other escapes: Windows, UNC and paths that are the folder itself", () => {
    for (const p of ["C:\\x", "C:x", "\\\\host\\share", "\\x", ".", "./", "a/.."]) {
      const bad = { ...minimal, turns: [{ id: "t1", writes: [{ path: p, content: "x" }] }] };
      expect(recordingSchema.safeParse(bad).success, p).toBe(false);
    }
    for (const p of [".claude/x", ".harness/tasks.json", "./.harness/x", ".claude"]) {
      const bad = { ...minimal, turns: [{ id: "t1", writes: [{ path: p, content: "x" }] }] };
      expect(recordingSchema.safeParse(bad).success, p).toBe(false);
    }
    const ok = { ...minimal, turns: [{ id: "t1", writes: [{ path: "a/b.md", content: "x" }] }] };
    expect(recordingSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a __proto__ reply label and a blank match", () => {
    const proto = JSON.parse('{"id":"t1","next":{"__proto__":"t1"}}');
    expect(recordingSchema.safeParse({ ...minimal, turns: [proto] }).success).toBe(false);
    expect(recordingSchema.safeParse({ ...minimal, match: "  \n" }).success).toBe(false);
  });

  it("rejects an unknown version and unknown keys", () => {
    expect(recordingSchema.safeParse({ ...minimal, version: 2 }).success).toBe(false);
    expect(recordingSchema.safeParse({ ...minimal, extra: true }).success).toBe(false);
  });

  it("a turn may carry setPhase (a phase id) or timeUp: true; nothing else", () => {
    const base = { version: 1, action: "session", match: "# Task: session" };
    expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1" }, { id: "t2", setPhase: "main" }, { id: "t3", timeUp: true }] }).success).toBe(true);
    for (const bad of [{ id: "t2", setPhase: "Main" }, { id: "t2", timeUp: false }, { id: "t2", setPhase: "" }]) {
      expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1" }, bad] }).success).toBe(false);
    }
  });
});

describe("loadRecordings", () => {
  it("loads the valid .json files and reports the others", () => {
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(minimal));
    fs.writeFileSync(path.join(root, "broken.json"), "{");
    fs.writeFileSync(path.join(root, "notes.txt"), "ignored");
    const { recordings, problems } = loadRecordings(root);
    expect(recordings.map((r) => r.action)).toEqual(["manifest"]);
    expect(problems).toEqual([expect.stringContaining("broken.json")]);
  });

  it("reports a file that parses as JSON but not as a recording", () => {
    fs.writeFileSync(path.join(root, "bad-schema.json"), JSON.stringify({ ...minimal, version: 9 }));
    const { problems } = loadRecordings(root);
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("bad-schema.json: version")]));
  });

  it("returns nothing for a missing folder", () => {
    expect(loadRecordings(path.join(root, "nope"))).toEqual({ recordings: [], problems: [] });
  });
});

describe("respond", () => {
  const base = { version: 1, action: "a", match: "# A", turns: [{ id: "t1" }, { id: "t2" }] };
  it("a turn may record answers, each with the turn it leads to", () => {
    const ok = { ...base, turns: [{ id: "t1", respond: [{ block: "commit_answer", value: { why: "x" }, next: "t2" }] }, { id: "t2" }] };
    expect(recordingSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ block: "commit_answer", value: { why: "x" } }, { block: "Bad", value: {}, next: "t2" }, { block: "b", value: "x", next: "t2" }, { block: "b", value: {}, next: "t2", extra: 1 }]) {
      expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1", respond: [bad] }, { id: "t2" }] }).success).toBe(false);
    }
  });
});

describe("mock Sidekick (sidekick plan Decision 12)", () => {
  const prompt = (flags: string[], text: string) =>
    ["Sidekick: pre-send review", "", "App: Demo", "Notes in this scope:", "- (none)", "Data tables:", "- (none)", flags.length ? "Local flags:" : "Local flags: none (the person asked for a review)", ...flags, "UI language: English", "", "<prompt>", text, "</prompt>", ""].join("\n");

  it("a flagged prompt gets a suggestion that keeps the prompt and adds what is missing", () => {
    const r = JSON.parse(mockSidekickReply(prompt(['- vague: "better" at [8, 14]'], "make it better")));
    expect(r.verdict).toBe("suggest");
    expect(r.issues[0].kind).toBe("vague");
    expect(r.rewrite.startsWith("make it better")).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("no flags: send", () => {
    expect(JSON.parse(mockSidekickReply(prompt([], "Rewrite paragraph 2"))).verdict).toBe("send");
  });

  it("two asks: the second one is queued", () => {
    const r = JSON.parse(mockSidekickReply(prompt(['- two-asks: "and also" at [9, 17]'], "Write it and also translate it")));
    expect(r.queued).toEqual(["translate it"]);
    expect(r.rewrite).toBe("Write it");
  });

  it("two asks on two lines: the second line is queued whole", () => {
    const r = JSON.parse(mockSidekickReply(prompt(['- two-asks: "Translate" at [9, 18]'], "Write it\nTranslate it")));
    expect(r.queued).toEqual(["Translate it"]);
    expect(r.rewrite).toBe("Write it");
  });

  it("two asks at the very start or end: no empty rewrite or queued prompt", () => {
    const atEnd = JSON.parse(mockSidekickReply(prompt(['- two-asks: "and also" at [9, 17]'], "Write it and also")));
    expect(atEnd.queued).toBeUndefined();
    expect(atEnd.rewrite).toBe("Write it");
    const atStart = JSON.parse(mockSidekickReply(prompt(['- two-asks: "and also" at [0, 8]'], "and also translate it")));
    expect(atStart.queued).toEqual(["translate it"]);
    expect(atStart.rewrite).toBe("and also translate it");
  });

  it("reads a flag match holding a quote (JSON-quoted)", () => {
    const r = JSON.parse(mockSidekickReply(prompt([`- vague: ${JSON.stringify('the "stuff"')} at [0, 11]`], 'the "stuff" please')));
    expect(r.verdict).toBe("suggest");
    expect(r.issues[0].kind).toBe("vague");
  });

  it("a note titled like a flag is not read as one", () => {
    const p = prompt([], "Rewrite paragraph 2").replace("Notes in this scope:\n- (none)", 'Notes in this scope:\n- vague: "x" at [0, 1]');
    expect(JSON.parse(mockSidekickReply(p)).verdict).toBe("send");
  });

  it("a Sidekick turn prints the reply and leaves the recordings and the session state alone", async () => {
    const dir = fs.mkdtempSync(path.join(root, "sk-"));
    const state = path.join(dir, "state", "mock.json");
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    try {
      const code = await runMockTurn(["--session-id", "sk-1"], prompt(['- vague: "better" at [8, 14]'], "make it better"), {}, { dir: path.join(dir, "no-recordings"), state });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const lines = out.join("").trim().split("\n").map((l) => JSON.parse(l));
    const result = lines.at(-1);
    expect(result).toMatchObject({ type: "result", subtype: "success", session_id: "sk-1" });
    expect(JSON.parse(result.result).verdict).toBe("suggest");
    expect(fs.existsSync(state)).toBe(false);
  });
});
