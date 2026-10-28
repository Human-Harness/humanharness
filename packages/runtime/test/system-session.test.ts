import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devLauncher, translateServerSpec } from "@humanharness/blocks";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { runSystemSession } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-syssession-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The fake Claude CLI with this script; `runs()` reads the argv and prompt of every run. */
function fake(script: ClaudeScript) {
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const prompts = path.join(dir, "prompts.jsonl");
  return {
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_PROMPTS: prompts },
    runs: () =>
      fs
        .readFileSync(prompts, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { argv: string[]; prompt: string }),
  };
}
const result = { line: { type: "result", subtype: "success", is_error: false, result: "done", usage: { input_tokens: 10, output_tokens: 2 } } };
const server = (rpc: { path: string; token: string }) => translateServerSpec({ rpc, launcher: devLauncher() });
const flag = (argv: string[], name: string) => argv[argv.indexOf(name) + 1];

describe("runSystemSession (language spec §5)", () => {
  it("runs one turn per prompt in the same session, with only its server, then removes its folder", async () => {
    const init = { line: { type: "system", subtype: "init", session_id: "fake-session" } };
    const f = fake({ steps: [init, { mcp: { server: "translate", tool: "save_translation", args: { strings: { "core:a": "b" } } } }, result] });
    const parent = path.join(root, "work");
    const seen: unknown[] = [];
    const turns: number[] = [];
    const prompts = ["first", "second"];
    const r = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent,
      handle: async (req) => {
        seen.push(req);
        return "Saved 1.";
      },
      next: async (i) => prompts[i] ?? null,
      onTurn: async (t, i) => {
        expect(t.ok).toBe(true);
        expect(t.usage?.inputTokens).toBe(10);
        turns.push(i);
      },
    });
    expect(r).toEqual({ ok: true, turns: 2 });
    expect(turns).toEqual([0, 1]);
    expect(seen).toEqual([
      { op: "save", strings: { "core:a": "b" } },
      { op: "save", strings: { "core:a": "b" } },
    ]);
    const runs = f.runs();
    expect(runs.map((x) => x.prompt)).toEqual(["first", "second"]);
    // The second turn resumes the first one's session, which Claude keeps on disk: persistence stays on.
    expect(runs[0].argv).toContain("--session-id");
    expect(runs[1].argv).toContain("--resume");
    expect(flag(runs[1].argv, "--resume")).toBe(flag(runs[0].argv, "--session-id"));
    for (const run of runs) expect(run.argv).not.toContain("--no-session-persistence");
    const servers = JSON.parse(flag(runs[0].argv, "--mcp-config")).mcpServers;
    expect(Object.keys(servers)).toEqual(["translate"]);
    const allowed = flag(runs[0].argv, "--allowedTools").split(",");
    const denied = flag(runs[0].argv, "--disallowedTools").split(",");
    for (const tool of ["Edit", "Write", "MultiEdit", "Bash", "WebFetch", "WebSearch"]) {
      expect(allowed.some((t) => t === tool || t.startsWith(`${tool}(`))).toBe(false);
      expect(denied).toContain(tool);
    }
    expect(allowed).toContain("mcp__translate");
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("stops at the first failed turn, and on abort; never throws", async () => {
    const f = fake({ steps: [{ line: { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" } }], exitCode: 1 });
    const parent = path.join(root, "w2");
    const r = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent,
      handle: async () => "",
      next: async (i) => (i < 3 ? "p" : null),
    });
    expect(r.ok).toBe(false);
    expect(r.turns).toBe(1);
    expect(r.error).toBeDefined();
    expect(fs.readdirSync(parent)).toEqual([]);
    const ac = new AbortController();
    ac.abort();
    const stopped = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent: path.join(root, "w3"),
      handle: async () => "",
      next: async () => "p",
      signal: ac.signal,
    });
    expect(stopped).toMatchObject({ ok: false, turns: 0, error: { code: "cancelled" } });
    // Stopped before it started: nothing was made.
    expect(fs.existsSync(path.join(root, "w3"))).toBe(false);
  });

  it("a stop during the run ends it as cancelled after that turn", async () => {
    const f = fake({ steps: [result] });
    const ac = new AbortController();
    const r = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent: path.join(root, "w5"),
      handle: async () => "",
      next: async () => "p",
      onTurn: async () => ac.abort(),
      signal: ac.signal,
    });
    expect(r).toMatchObject({ ok: false, turns: 1, error: { code: "cancelled" } });
  });

  it("a throwing callback is a failed result, not a throw", async () => {
    const f = fake({ steps: [result] });
    const r = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent: path.join(root, "w6"),
      handle: async () => "",
      next: async () => {
        throw new Error("no prompt");
      },
    });
    expect(r).toMatchObject({ ok: false, turns: 0, error: { code: "agent-crashed", detail: "no prompt" } });
    expect(fs.readdirSync(path.join(root, "w6"))).toEqual([]);
  });

  it("caps the number of turns", async () => {
    const f = fake({ steps: [result] });
    const r = await runSystemSession({
      engine: getEngine("claude"),
      command: f.command,
      env: f.env,
      server,
      parent: path.join(root, "w4"),
      handle: async () => "",
      next: async () => "again",
      maxTurns: 3,
    });
    expect(r).toEqual({ ok: true, turns: 3 });
    expect(f.runs()).toHaveLength(3);
  });
});
