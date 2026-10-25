import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type EngineStatus, canOpenFile, engineProblem, isTextSize, nextInPath, stepTextSize } from "../src/client";
import { FakeClient } from "./fake-client";

const ready: EngineStatus = {
  engineId: "claude",
  installed: true,
  version: "2.1.296",
  minVersion: "2.1.296",
  outdated: false,
  loggedIn: true,
  noticeAccepted: true,
  verified: true,
};

describe("engineProblem", () => {
  it("is null when the engine is ready", () => {
    expect(engineProblem(ready)).toBeNull();
    expect(engineProblem({ ...ready, loggedIn: null })).toBeNull();
  });

  it("asks for the notice first, then install, update, sign-in and the test prompt", () => {
    expect(engineProblem({ ...ready, noticeAccepted: false, installed: false })).toBe("notice");
    expect(engineProblem({ ...ready, installed: false, loggedIn: false })).toBe("not-installed");
    expect(engineProblem({ ...ready, outdated: true, loggedIn: false })).toBe("outdated");
    expect(engineProblem({ ...ready, loggedIn: false, verified: false })).toBe("logged-out");
    expect(engineProblem({ ...ready, verified: false })).toBe("untested");
  });
});

describe("@humanharness/ui/client", () => {
  it("is exported on its own and imports no runtime code (no React)", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(pkg.exports["./client"]).toBe("./src/client.ts");
    const src = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
    expect(src.match(/^import .*$/gm)?.every((line) => line.startsWith("import type "))).toBe(true);
  });
});

describe("nextInPath", () => {
  const path = ["manifest", "engines", "turn"];
  it("follows the path from the current action", () => {
    expect(nextInPath(path, "manifest", {})).toBe("engines");
    expect(nextInPath(path, "engines", { manifest: "done" })).toBe("turn");
  });

  it("from the end, outside the path or idle, suggests the first action not done yet", () => {
    expect(nextInPath(path, "turn", { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "other", { manifest: "done", engines: "unfinished" })).toBe("engines");
    expect(nextInPath(path, undefined, { manifest: "done" })).toBe("engines");
    expect(nextInPath(path, "turn", { manifest: "done", engines: "done" })).toBeNull();
    expect(nextInPath([], undefined, {})).toBeNull();
  });
});

describe("canOpenFile", () => {
  it("is true for text, data and images, and false for sources, pages and programs", () => {
    for (const f of ["a.md", "notes/b.JSON", "c.csv", "d.png", "e.pdf", "f.css"]) expect(canOpenFile(f)).toBe(true);
    for (const f of ["a.ts", "b.tsx", "c.js", "d.html", "e.svg", "run.command", "Makefile", "x.sh"]) expect(canOpenFile(f)).toBe(false);
  });
});

describe("text size", () => {
  it("steps one size at a time and stays put at either end", () => {
    expect(stepTextSize(undefined, "in")).toBe("large");
    expect(stepTextSize("large", "in")).toBe("larger");
    expect(stepTextSize("larger", "in")).toBe("largest");
    expect(stepTextSize("largest", "in")).toBe("largest");
    expect(stepTextSize("larger", "out")).toBe("large");
    expect(stepTextSize(undefined, "out")).toBe("normal");
  });

  it("goes back to normal from any size", () => {
    expect(stepTextSize("largest", "reset")).toBe("normal");
    expect(stepTextSize(undefined, "reset")).toBe("normal");
  });

  it("knows only its four sizes", () => {
    expect(["normal", "large", "larger", "largest"].every(isTextSize)).toBe(true);
    expect(isTextSize("huge")).toBe(false);
    expect(isTextSize(1.5)).toBe(false);
    expect(isTextSize("toString")).toBe(false);
  });
});

describe("the scopes contract", () => {
  it("lists, creates, opens and archives scopes, and tells listeners", async () => {
    const client = new FakeClient();
    const seen: (string | null)[] = [];
    const off = client.scopes.onChange((v) => seen.push(v.open));
    const s = await client.scopes.create("Fractions");
    expect(await client.scopes.open(s.id)).toBe(true);
    expect(await client.scopes.current()).toBe(s.id);
    await client.scopes.archive(s.id);
    expect(await client.scopes.current()).toBeNull();
    expect((await client.scopes.list())[0]).toMatchObject({ id: s.id, archived: true });
    off();
    expect(seen).toEqual([null, s.id, null]);
  });
});
