import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeAcpCommand, writeScript } from "@humanharness/fake-agent";
import { AcpTransport } from "../src/acp";
import { claudeArgs } from "../src/claude-cli";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-d0-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

describe("D0 (hatches): no linked folders, no change", () => {
  it("claudeArgs without a scope, or with an empty one, is the golden argv", () => {
    const o = { session: { id: "abc", started: false }, mcp: [uiServer], permissions, references: ["/r"] };
    const golden = claudeArgs(o);
    expect(claudeArgs({ ...o, scope: undefined })).toEqual(golden);
    expect(claudeArgs({ ...o, scope: { linked: [] } })).toEqual(golden);
    expect(claudeArgs({ ...o, references: [], scope: { linked: [] } })).not.toContain("--settings");
  });
  it("session/new and session/load carry exactly cwd and mcpServers without linked folders", async () => {
    const folder = fs.mkdtempSync(path.join(root, "t-"));
    const logFile = path.join(root, `log-${path.basename(folder)}.jsonl`);
    const script = { additionalDirectories: true, loadSession: true, turns: [[{ stop: "end_turn" as const }], [{ stop: "end_turn" as const }]] };
    const t = new AcpTransport({
      folder,
      session: { id: "local", started: false },
      mcp: [uiServer],
      permissions,
      command: fakeAcpCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_LOG: logFile },
      onSessionStarted: () => {},
    });
    try {
      const turn = () => t.turn("hi", () => {}, new AbortController().signal);
      await turn();
      // A new process loads the started session.
      await t.close();
      await turn();
    } finally {
      await t.close();
    }
    const log = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method: string; params: Record<string, unknown> });
    expect(Object.keys(log.find((l) => l.method === "session/new")!.params).sort()).toEqual(["cwd", "mcpServers"]);
    expect(Object.keys(log.find((l) => l.method === "session/load")!.params).sort()).toEqual(["cwd", "mcpServers", "sessionId"]);
  });
});
