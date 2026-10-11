import { describe, expect, it } from "vitest";
import { configProblem, folderProblem, isAppUrl } from "../src/main/validate";

const home = "/Users/ana";
const ctx = { engineIds: ["claude", "codex"], languages: ["es", "en"], home };

describe("folderProblem", () => {
  it("accepts a normal folder", () => {
    expect(folderProblem("/Users/ana/Mi Agenda", home)).toBeNull();
    expect(folderProblem("/Users/ana/Documents/Mi Agenda", home)).toBeNull();
    expect(folderProblem("/Volumes/data/work", home)).toBeNull();
  });

  it.each([
    "relative/path",
    "",
    "/",
    "/Users",
    "/Users/ana",
    "/Users/ana/",
    "/Users/ana/Documents",
    "/Users/ana/Desktop",
    "/Users/ana/Downloads",
    "/Users/ana/Library",
    "/Users/ana/Pictures",
    "/Users/ana/Movies",
    "/Users/ana/Music",
    "/Users/ana/Public",
    "/Users/ana/Applications",
    "/Users/ana/documents",
    "/Users/ana/.claude",
    "/Users/ana/.claude/projects",
    "/Users/ana/.codex/x",
    "/Users/ana/Library/Application Support/x",
    "/Users/ana/Documents/../.claude",
  ])("rejects %j", (folder) => {
    expect(folderProblem(folder, home)).not.toBeNull();
  });

  it("does not confuse a sibling prefix with a protected folder", () => {
    expect(folderProblem("/Users/ana/.claudette", home)).toBeNull();
  });
});

describe("configProblem", () => {
  it("accepts a valid partial or full config", () => {
    expect(configProblem({ language: "es" }, ctx)).toBeNull();
    expect(configProblem({ language: "en", engineId: "codex", folder: "/Users/ana/Work" }, ctx)).toBeNull();
  });

  it("rejects an engine the harness does not offer", () => {
    expect(configProblem({ engineId: "gemini" }, ctx)).not.toBeNull();
  });

  it("rejects a language the harness does not have", () => {
    expect(configProblem({ language: "fr" as never }, ctx)).not.toBeNull();
  });

  it("rejects a bad folder", () => {
    expect(configProblem({ folder: "/Users/ana" }, ctx)).not.toBeNull();
  });

  it("rejects non-string values and non-objects", () => {
    expect(configProblem({ folder: 3 as never }, ctx)).not.toBeNull();
    expect(configProblem(null as never, ctx)).not.toBeNull();
  });
});

describe("isAppUrl", () => {
  it("matches the dev server origin", () => {
    const where = { devUrl: "http://localhost:5173", rendererFile: "/app/out/renderer/index.html" };
    expect(isAppUrl("http://localhost:5173/", where)).toBe(true);
    expect(isAppUrl("http://localhost:5174/", where)).toBe(false);
    expect(isAppUrl("https://evil.example/", where)).toBe(false);
  });

  it("matches only the renderer file in production", () => {
    const where = { rendererFile: "/app/out/renderer/index.html" };
    expect(isAppUrl("file:///app/out/renderer/index.html", where)).toBe(true);
    expect(isAppUrl("file:///app/out/renderer/index.html#x", where)).toBe(true);
    expect(isAppUrl("file:///etc/passwd", where)).toBe(false);
    expect(isAppUrl("not a url", where)).toBe(false);
  });
});
