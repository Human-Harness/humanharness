import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SCOPE, MAIN_SCOPE, NOTES_PREFIX, chatFile, chatsDir, isScopeDir, isScopeId, notesPrefix, scopesFile, setupFile, tasksFile, usageFile } from "../src";

describe("layout", () => {
  it("keeps today's places for a harness without scopes", () => {
    expect(NOTES_PREFIX).toBe(".harness/notes/");
    expect(notesPrefix(false)).toBe(".harness/notes/");
    expect(notesPrefix(false, "anything-at-all")).toBe(".harness/notes/");
    expect(chatFile("/w", MAIN_SCOPE)).toBe(path.join("/w", ".harness", "chats", "main.jsonl"));
    expect(tasksFile("/w")).toBe(path.join("/w", ".harness", "tasks.json"));
    expect(usageFile("/w")).toBe(path.join("/w", ".harness", "usage.jsonl"));
  });

  it("setup.json sits under .harness/, next to tasks.json (setup-steps spec §4)", () => {
    expect(setupFile("/f")).toBe(path.join("/f", ".harness", "setup.json"));
  });

  it("gives each scope its own notes folder and chat", () => {
    expect(notesPrefix(true, "fracciones")).toBe(".harness/notes/fracciones/");
    expect(notesPrefix(true, APP_SCOPE)).toBe(".harness/notes/_app/");
    expect(notesPrefix(true)).toBe(".harness/notes/main/");
    expect(chatFile("/w", "fracciones")).toBe(path.join("/w", ".harness", "chats", "fracciones.jsonl"));
    expect(chatFile("/w", APP_SCOPE)).toBe(path.join("/w", ".harness", "chats", "_app.jsonl"));
    expect(chatsDir("/w")).toBe(path.join("/w", ".harness", "chats"));
    expect(scopesFile("/w")).toBe(path.join("/w", ".harness", "scopes.json"));
  });

  it("refuses a scope that could leave its folder", () => {
    expect(() => notesPrefix(true, "../x")).toThrow(/scope/);
    expect(() => chatFile("/w", "a/b")).toThrow(/scope/);
    expect(() => chatFile("/w", "")).toThrow(/scope/);
  });

  it("tells scope ids from scope folders", () => {
    expect(isScopeId("fracciones-2")).toBe(true);
    expect(isScopeId(APP_SCOPE)).toBe(false);
    expect(isScopeId("Fracciones")).toBe(false);
    expect(isScopeId("a".repeat(65))).toBe(false);
    expect(isScopeDir(APP_SCOPE)).toBe(true);
    expect(isScopeDir("main")).toBe(true);
    expect(isScopeDir("_other")).toBe(false);
    expect(isScopeDir(3)).toBe(false);
  });
});
