import { describe, expect, it } from "vitest";
import { checkFolder, configProblem, folderProblem, isAppUrl, realFolder } from "../src/main/validate";

const home = "/Users/ana";
/** A fake file system: these paths exist (as themselves) and `links` are symlinks to their targets. */
function fakeRealpath(existing: string[], links: Record<string, string> = {}) {
  return async (p: string) => {
    for (const [link, target] of Object.entries(links)) {
      if (p === link || p.startsWith(link + "/")) return target + p.slice(link.length);
    }
    if (existing.includes(p)) return p;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
}
const realpath = fakeRealpath(["/", "/Users", home, "/Users/ana/Work", "/Volumes"], { "/Users/ana/Work/link": "/Users/ana/.claude" });
const ctx = { engineIds: ["claude", "codex"], languages: ["es", "en"], home, realpath };

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
    "/Users/ana/.gemini",
    "/Users/ana/.Gemini/tmp",
    "/Users/ana/Library/Application Support/x",
    "/Users/ana/Documents/../.claude",
  ])("rejects %j", (folder) => {
    expect(folderProblem(folder, home)).not.toBeNull();
  });

  it("does not confuse a sibling prefix with a protected folder", () => {
    expect(folderProblem("/Users/ana/.claudette", home)).toBeNull();
  });

  it("says why, with a code", () => {
    expect(folderProblem("relative", home)).toBe("not-absolute");
    expect(folderProblem("/", home)).toBe("root");
    expect(folderProblem("/Users/ana", home)).toBe("home");
    expect(folderProblem("/Users/ana/Documents", home)).toBe("too-broad");
    expect(folderProblem("/Users/ana/.claude/x", home)).toBe("protected");
    expect(folderProblem("/usr/local/work", home)).toBe("protected");
  });

  it.each(["/System", "/usr", "/usr/local/x", "/bin", "/sbin", "/etc", "/private", "/private/tmp/x", "/var/x", "/Applications/Foo", "/Library", "/Library/x", "/opt/work", "/Volumes"])(
    "rejects the system folder %j",
    (folder) => {
      expect(folderProblem(folder, home)).toBe("protected");
    },
  );

  it("accepts folders inside cloud drives, but not the drive roots or the rest of Library", () => {
    const icloud = "/Users/ana/Library/Mobile Documents/com~apple~CloudDocs";
    const cloud = "/Users/ana/Library/CloudStorage";
    expect(folderProblem(`${icloud}/Mi Agenda`, home)).toBeNull();
    expect(folderProblem(`${cloud}/GoogleDrive-ana@example.com/Mi Agenda`, home)).toBeNull();
    expect(folderProblem(`${cloud}/Dropbox/Work/Notes`, home)).toBeNull();
    for (const bad of [
      icloud,
      "/Users/ana/Library/Mobile Documents",
      "/Users/ana/Library/Mobile Documents/other.app/x",
      cloud,
      `${cloud}/Dropbox`,
      "/Users/ana/Library",
      "/Users/ana/Library/Application Support/x",
    ]) {
      expect(folderProblem(bad, home), bad).toBe("protected");
    }
  });
});

describe("realFolder", () => {
  it("resolves symlinks, and rejoins a missing tail onto the nearest existing parent", async () => {
    expect(await realFolder("/Users/ana/Work/link/projects", realpath)).toBe("/Users/ana/.claude/projects");
    expect(await realFolder("/Users/ana/Work/new/deeper", realpath)).toBe("/Users/ana/Work/new/deeper");
  });
});

describe("checkFolder", () => {
  it("checks where the folder really is", async () => {
    expect(await checkFolder("/Users/ana/Work/link", home, realpath)).toBe("protected");
    expect(await checkFolder("/Users/ana/Work/new", home, realpath)).toBeNull();
    expect(await checkFolder("relative", home, realpath)).toBe("not-absolute");
  });

  it("uses the real file system by default (/tmp is /private/tmp on macOS)", async () => {
    expect(await checkFolder("/tmp/hh-surely-missing/x", "/Users/ana")).toBe("protected");
  });
});

describe("configProblem", () => {
  it("accepts a valid partial or full config", async () => {
    expect(await configProblem({ language: "es" }, ctx)).toBeNull();
    expect(await configProblem({ language: "en", engineId: "codex", folder: "/Users/ana/Work" }, ctx)).toBeNull();
  });

  it("rejects an engine the harness does not offer", async () => {
    expect(await configProblem({ engineId: "gemini" }, ctx)).toBe("engine-unavailable");
  });

  it("rejects a language the harness does not have", async () => {
    expect(await configProblem({ language: "fr" as never }, ctx)).toBe("language-unavailable");
  });

  it("accepts only the known appearances", async () => {
    expect(await configProblem({ appearance: "dark" }, ctx)).toBeNull();
    expect(await configProblem({ appearance: "neon" as never }, ctx)).toBe("invalid");
  });

  it("rejects a bad folder, with the folder's code", async () => {
    expect(await configProblem({ folder: "/Users/ana" }, ctx)).toBe("home");
    expect(await configProblem({ folder: "/Users/ana/Work/link" }, ctx)).toBe("protected");
  });

  it("rejects non-string values and non-objects", async () => {
    expect(await configProblem({ folder: 3 as never }, ctx)).not.toBeNull();
    expect(await configProblem(null as never, ctx)).not.toBeNull();
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
