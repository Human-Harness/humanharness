import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type EngineStatus, engineProblem } from "../src/client";

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
