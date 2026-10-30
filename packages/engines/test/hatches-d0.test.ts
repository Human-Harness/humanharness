import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeAcpCommand, writeScript } from "@humanharness/fake-agent";
import { AcpTransport } from "../src/acp/client";
import { claudeArgs } from "../src/claude/transport";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-d0-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

describe("D0 (hatches): no linked folders, no change", () => {
  it("claudeArgs without a scope, or with an empty one, is the golden argv", () => {
    const head = [
      "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--setting-sources", "project",
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read,Glob,Grep,TodoWrite,Edit(./**),Write(./**),MultiEdit(./**),mcp__ui",
    ];
    const mcpConfig = ["--strict-mcp-config", "--mcp-config", JSON.stringify({
      mcpServers: { ui: { type: "stdio", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } } },
    })];
    const deny = "AskUserQuestion,Bash,WebSearch,WebFetch,Edit(.claude/**),Write(.claude/**),MultiEdit(.claude/**)";
    // With a reference folder: its one --settings and its edit deny rules, nothing more.
    const withRef = [
      ...head,
      "--disallowedTools", `${deny},Edit(//r/**),Write(//r/**),MultiEdit(//r/**)`,
      ...mcpConfig,
      "--settings", JSON.stringify({ permissions: { additionalDirectories: ["/r"] } }),
      "--session-id", "abc",
    ];
    // Without references: no --settings at all.
    const plain = [...head, "--disallowedTools", deny, ...mcpConfig, "--session-id", "abc"];
    const o = { session: { id: "abc", started: false }, mcp: [uiServer], permissions, references: ["/r"] };
    for (const scope of [undefined, { linked: [] }]) {
      expect(claudeArgs({ ...o, scope })).toEqual(withRef);
      expect(claudeArgs({ ...o, references: [], scope })).toEqual(plain);
    }
  });

  it("D0: no engine preset → part 1's argv", () => {
    const o = { session: { id: "abc", started: true }, mcp: [uiServer], permissions, references: ["/r"] };
    const linked = [{ path: "/l", mode: "read" as const, tracked: false }];
    expect(claudeArgs({ ...o, scope: { linked: [] } })).toEqual(claudeArgs(o));
    expect(claudeArgs({ ...o, scope: { linked, engine: undefined } })).toEqual(claudeArgs({ ...o, scope: { linked } }));
    for (const flag of ["--plugin-dir", "--agents"]) expect(claudeArgs({ ...o, scope: { linked } })).not.toContain(flag);
  });

  it("an empty preset folder changes nothing", () => {
    // The host passes no engine for a scope with an empty (or no) engine folder: the argv is part 1's, linked or not.
    const o = { session: { id: "abc", started: false }, mcp: [uiServer], permissions, references: [] };
    const linked = [{ path: "/l", mode: "write" as const, tracked: false }];
    for (const scope of [{ linked: [] }, { linked }]) {
      const args = claudeArgs({ ...o, scope: { ...scope, engine: undefined } });
      expect(args).toEqual(claudeArgs({ ...o, scope }));
      expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
      expect(args).toContain("--strict-mcp-config");
    }
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
