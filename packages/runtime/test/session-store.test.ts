import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readSession, writeSession } from "../src/session-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("session store", () => {
  it("creates a fresh session when there is none", async () => {
    const folder = fs.mkdtempSync(path.join(root, "t-"));
    const s = await readSession(folder, "claude");
    expect(s.started).toBe(false);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("round-trips a session for the same engine", async () => {
    const folder = fs.mkdtempSync(path.join(root, "t-"));
    await writeSession(folder, "claude", { id: "abc", started: true });
    expect(await readSession(folder, "claude")).toEqual({ id: "abc", started: true });
    expect(fs.existsSync(path.join(folder, ".harness", "session.json"))).toBe(true);
  });

  it("starts over when the engine changed", async () => {
    const folder = fs.mkdtempSync(path.join(root, "t-"));
    await writeSession(folder, "claude", { id: "abc", started: true });
    expect((await readSession(folder, "codex")).started).toBe(false);
  });
});
