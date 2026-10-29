import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SCOPE, ENGINE_PREFIX, MAIN_SCOPE, MATERIAL_KEEP, appHistoryKeep, engineConfigDir, NOTES_PREFIX, attentionFile, chatFile, chatsDir, isScopeDir, isScopeId, isTaskId, taskChatFile, materialDir, materialReadsFile, materialStoreDir, notesPrefix, pluginDataDir, pluginStateDir, profilesFile, scopesFile, setupFile, tasksFile, usageFile } from "../src";

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

describe("plugin paths (plugins spec §3.3, §6)", () => {
  it("state, data and the inbox live under .harness/", () => {
    expect(pluginStateDir("/w", "oncall")).toBe(path.join("/w", ".harness", "plugins", "oncall"));
    expect(pluginDataDir("/w", "oncall")).toBe(path.join("/w", ".harness", "plugin-data", "oncall"));
    expect(attentionFile("/w")).toBe(path.join("/w", ".harness", "attention.json"));
  });

  it("an id that isn't a plugin id names no folder", () => {
    expect(() => pluginStateDir("/w", "../x")).toThrow(/plugin/);
    expect(() => pluginDataDir("/w", "")).toThrow(/plugin/);
    expect(() => pluginStateDir("/w", "Oncall")).toThrow(/plugin/);
  });
});

describe("per-task chats (parallel spec §6)", () => {
  it("taskChatFile: chats/<scope>/<task>.jsonl", () => {
    expect(taskChatFile("/b", "main", "t1")).toBe(path.join("/b", ".harness", "chats", "main", "t1.jsonl"));
    expect(taskChatFile("/b", "_app", "0b6c2d1e-8f3a-4c5d-9e7f-1a2b3c4d5e6f")).toBe(
      path.join("/b", ".harness", "chats", "_app", "0b6c2d1e-8f3a-4c5d-9e7f-1a2b3c4d5e6f.jsonl"),
    );
  });

  it("refuses a task id that could leave the scope's folder, and a bad scope", () => {
    for (const bad of ["../x", "..", ".", "a/b", "a\\b", "", "_x", "-x", "__proto__", "a.b", "t1\0", "T1", "x".repeat(201)]) {
      expect(() => taskChatFile("/b", "main", bad), bad).toThrow(/task/);
      expect(isTaskId(bad)).toBe(false);
    }
    expect(isTaskId("x".repeat(200))).toBe(true);
    expect(() => taskChatFile("/b", "../x", "t1")).toThrow(/scope/);
    expect(() => taskChatFile("/b", "archive", "t1")).toThrow(/archive/);
  });
});

describe("engine config folder (hatches spec §5.1)", () => {
  it("engineConfigDir is .harness/engine/<scope>", () => {
    expect(ENGINE_PREFIX).toBe(".harness/engine/");
    expect(engineConfigDir("/w", "intro")).toBe(path.join("/w", ".harness", "engine", "intro"));
  });

  it("refuses a scope id that escapes, and _app", () => {
    expect(() => engineConfigDir("/w", "../x")).toThrow(/scope/);
    expect(() => engineConfigDir("/w", "a/b")).toThrow(/scope/);
    expect(() => engineConfigDir("/w", "")).toThrow(/scope/);
    expect(() => engineConfigDir("/w", "_app")).toThrow(/scope/);
  });

  it("D0: .harness/engine is not kept without enginePresets", () => {
    expect(appHistoryKeep(false)).not.toContain(ENGINE_PREFIX);
    expect(appHistoryKeep(true)).not.toContain(ENGINE_PREFIX);
    expect(appHistoryKeep(false, false)).toEqual(appHistoryKeep(false));
    expect(appHistoryKeep(false, true)).toContain(ENGINE_PREFIX);
    expect(appHistoryKeep(false, true)).toEqual([...appHistoryKeep(false), ENGINE_PREFIX]);
    expect(appHistoryKeep(true, true)).toEqual([...appHistoryKeep(true), ENGINE_PREFIX]);
  });
});
