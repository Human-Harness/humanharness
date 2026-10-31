import { describe, expect, it } from "vitest";
import { actionDocs, chatDocs, chatScope, docIdFor, fileDoc, fileKey, noteScope, openTaskDoc, pastTaskDocs, splitKey } from "../src";

const line = (o: unknown, offset = 0) => {
  const text = JSON.stringify(o);
  return { offset, length: Buffer.byteLength(text), line: text };
};

describe("file and note documents", () => {
  it("a folder file: its name as title, path, text, app-wide with scopes", () => {
    const d = fileDoc({ root: "folder", rel: "docs/guide.md", mtimeMs: 5.4, text: "# Guide", scoped: true });
    expect(d).toEqual({ id: "file:folder/docs/guide.md", kind: "file", scope: "_app", title: "guide.md", path: "docs/guide.md", text: "# Guide", at: 5, root: "folder" });
    expect(fileDoc({ root: "folder", rel: "a.txt", mtimeMs: 1, text: null, scoped: false }).scope).toBe("main");
  });

  it("a note: its front-matter title, its scope from the folder, secret lines left out", () => {
    const text = `---\ntitle: Engines\n---\n## Summary\n- ghp_${"A".repeat(36)}\n- budget`;
    const d = fileDoc({ root: "folder", rel: ".harness/notes/physics/engines.md", mtimeMs: 1, text, scoped: true });
    expect(d.kind).toBe("note");
    expect(d.id).toBe("note:.harness/notes/physics/engines.md");
    expect(d.title).toBe("Engines");
    expect(d.scope).toBe("physics");
    expect(d.text).not.toContain("ghp_");
    expect(d.text).toContain("budget");
  });

  it("a note's title falls back to its first # heading, then its name", () => {
    expect(fileDoc({ root: "folder", rel: ".harness/notes/a.md", mtimeMs: 1, text: "# The turn\nx", scoped: false }).title).toBe("The turn");
    expect(fileDoc({ root: "folder", rel: ".harness/notes/a.md", mtimeMs: 1, text: null, scoped: false }).title).toBe("a");
  });

  it("note scopes", () => {
    expect(noteScope(".harness/notes/a.md", false)).toBe("main");
    expect(noteScope(".harness/notes/a.md", true)).toBe("_app");
    expect(noteScope(".harness/notes/_app/a.md", true)).toBe("_app");
  });

  it("a reference folder's markdown is a file, not a note", () => {
    expect(fileDoc({ root: "ref:docs", rel: ".harness/notes/a.md", mtimeMs: 1, text: "", scoped: false }).kind).toBe("file");
    expect(docIdFor("ref:docs", "a.md")).toBe("file:ref:docs/a.md");
  });

  it("keys split back into root and path", () => {
    expect(splitKey(fileKey("ref:docs", "a/b.md"))).toEqual({ root: "ref:docs", rel: "a/b.md" });
  });
});

describe("chat documents (§3 Tasks)", () => {
  it("one per entry with text; notices, mode and phase lines and empty entries are left out", () => {
    const docs = chatDocs(".harness/chats/main.jsonl", [
      line({ id: "u1", role: "user", text: "How does the context window work?", at: "2026-10-30T10:00:00.000Z", task: "t1" }, 0),
      line({ id: "a1", role: "assistant", text: "It holds the turn.", at: "2026-10-30T10:00:01.000Z", task: "t1" }, 100),
      line({ id: "n1", role: "user", text: "", notice: { kind: "x" } }, 200),
      line({ id: "m1", role: "user", text: "Switched", mode: "deep" }, 300),
      line({ id: "e1", role: "assistant", text: "" }, 400),
    ]);
    expect(docs.map((d) => d.id)).toEqual(["chat:.harness/chats/main.jsonl#u1", "chat:.harness/chats/main.jsonl#a1"]);
    expect(docs[0]).toMatchObject({ kind: "task", scope: "main", title: "How does the context window work?", chat: { file: ".harness/chats/main.jsonl", offset: 0, entry: "u1", task: "t1" }, meta: { role: "user" } });
    expect(docs[1].chat?.offset).toBe(100);
  });

  it("cuts a long first line, leaves out secret lines and skips a broken line", () => {
    const long = "x".repeat(200);
    const docs = chatDocs(".harness/chats/physics/t1.jsonl", [
      { offset: 0, length: 3, line: "{no" },
      line({ id: "u1", role: "user", text: `${long}\nghp_${"A".repeat(36)}`, at: "x" }),
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].title.length).toBe(80);
    expect(docs[0].text).not.toContain("ghp_");
    expect(docs[0].scope).toBe("physics");
    expect(docs[0].at).toBe(0);
  });

  it("chat scopes", () => {
    expect(chatScope(".harness/chats/_app.jsonl")).toBe("_app");
    expect(chatScope(".harness/chats/physics/t9.jsonl")).toBe("physics");
  });
});

describe("tasks built in memory (§4.2)", () => {
  it("actions with their status and tier", () => {
    expect(actionDocs([{ id: "topic5", label: "Topic 5", description: "Blocks", tier: "deep", scope: "_app" }])[0]).toEqual({
      id: "action:topic5",
      kind: "task",
      scope: "_app",
      title: "Topic 5",
      path: "",
      text: "Blocks",
      at: 0,
      action: "topic5",
      meta: { status: "not-started", tier: "deep" },
    });
    expect(actionDocs([{ id: "a", label: "A", status: "done", scope: "main" }])[0].meta).toEqual({ status: "done" });
  });

  it("the open task and past tasks", () => {
    expect(openTaskDoc({ id: "t1", title: "Topic 5", scope: "main", at: 0 })).toMatchObject({ id: "open:t1", task: "t1", meta: { status: "open" } });
    expect(pastTaskDocs([{ id: "t0", title: "The turn", scope: "main", at: 9 }])[0]).toMatchObject({ id: "past:t0", task: "t0", at: 9, meta: { status: "past" } });
  });
});
