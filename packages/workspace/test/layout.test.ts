import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SCOPE, MAIN_SCOPE, MATERIAL_KEEP, NOTES_PREFIX, chatFile, chatsDir, isScopeDir, isScopeId, materialDir, materialReadsFile, materialStoreDir, notesPrefix, profilesFile, scopesFile, setupFile, tasksFile, usageFile } from "../src";

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

  it("the profile registry sits under the app folder's .harness/ (profiles spec §4)", () => {
    expect(profilesFile("/f")).toBe(path.join("/f", ".harness", "profiles.json"));
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

describe("material paths (material spec §4)", () => {
  it("the originals are visible, the rest is hidden, both per scope", () => {
    expect(materialDir("/w", "fractions")).toBe(path.join("/w", "material", "fractions"));
    expect(materialStoreDir("/w", "main")).toBe(path.join("/w", ".harness", "material", "main"));
    expect(materialReadsFile("/w")).toBe(path.join("/w", ".harness", "material-reads.jsonl"));
  });

  it("app-wide work has no material, and a bad scope names no folder", () => {
    expect(() => materialDir("/w", APP_SCOPE)).toThrow();
    expect(() => materialStoreDir("/w", APP_SCOPE)).toThrow();
    expect(() => materialStoreDir("/w", "../x")).toThrow();
  });

  it("MATERIAL_KEEP: the registry, the conflicts and the grounding mode, nothing else", () => {
    const keeps = (p: string) => MATERIAL_KEEP.match.test(p);
    expect(keeps(".harness/material/main/sources.json")).toBe(true);
    expect(keeps(".harness/material/fractions/conflicts.md")).toBe(true);
    expect(keeps(".harness/material/fractions/grounding.json")).toBe(true);
    expect(keeps(".harness/material/main/index.md")).toBe(false);
    expect(keeps(".harness/material/main/fragments/a-001.md")).toBe(false);
    expect(keeps(".harness/material/main/fragments/sources.json")).toBe(false);
    expect(keeps(".harness/material/main/sources.json.1234.tmp")).toBe(false);
    expect(keeps(".harness/material/_app/sources.json")).toBe(false);
  });
});
