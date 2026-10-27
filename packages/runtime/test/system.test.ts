import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { runSystemTask } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-system-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The fake Claude CLI with this script; `args()` reads the argv it ran with. */
function fakeClaude(script: ClaudeScript) {
  const dir = fs.mkdtempSync(path.join(root, "t-"));
  const argsFile = path.join(dir, "args.json");
  return {
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(dir, script), HH_FAKE_ARGS: argsFile },
    args: () => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[],
  };
}

const tempFolders = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("hh-material-"));

describe("runSystemTask (material spec §10)", () => {
  it("one session in an empty folder with only the material server; the stage's tool answers over RPC", async () => {
    const seen: unknown[] = [];
    const fake = fakeClaude({
      steps: [
        { mcp: { server: "material", tool: "material_read", args: { id: "x-001" } } },
        { line: { type: "result", subtype: "success", is_error: false, result: "done", usage: { input_tokens: 100, output_tokens: 20 } } },
      ],
    });
    const before = new Set(tempFolders());
    const r = await runSystemTask({
      engine: getEngine("claude"),
      command: fake.command,
      env: fake.env,
      prompt: "material-review: check these",
      tools: [],
      handle: async (req) => {
        seen.push(req);
        return "Saved.";
      },
    });
    expect(r.ok).toBe(true);
    expect(r.usage?.inputTokens).toBe(100);
    expect(seen).toEqual([{ op: "read", id: "x-001" }]);
    const argv = fake.args();
    const servers = (JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: Record<string, { env: Record<string, string> }> }).mcpServers;
    expect(Object.keys(servers)).toEqual(["material"]);
    expect(servers.material.env.HH_MATERIAL_MODE).toBe("system");
    expect(argv).toContain("--no-session-persistence");
    // No edits, no commands, no web: only reading and the material server.
    const allowed = argv[argv.indexOf("--allowedTools") + 1].split(",");
    const denied = argv[argv.indexOf("--disallowedTools") + 1].split(",");
    for (const tool of ["Edit", "Write", "MultiEdit", "Bash", "WebFetch", "WebSearch"]) {
      expect(allowed.some((t) => t === tool || t.startsWith(`${tool}(`))).toBe(false);
      expect(denied).toContain(tool);
    }
    expect(allowed).toContain("mcp__material");
    // The empty working folder is gone afterwards.
    expect(tempFolders().filter((n) => !before.has(n))).toEqual([]);
  });

  it("the review stage's tool reaches the app, checked by the server's schema", async () => {
    const seen: unknown[] = [];
    const fake = fakeClaude({
      steps: [
        { mcp: { server: "material", tool: "material_review", args: { verdict: "good", fragments: [], issues: [] } } },
        { line: { type: "result", subtype: "success", is_error: false, result: "done" } },
      ],
    });
    const r = await runSystemTask({
      engine: getEngine("claude"),
      command: fake.command,
      env: fake.env,
      prompt: "material-review\n\nCheck these.",
      tools: ["material_review"],
      handle: async (req) => {
        seen.push(req);
        return "Saved.";
      },
    });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([{ op: "material_review", verdict: "good", fragments: [], issues: [] }]);
  });

  it("a crash or a timeout is a failed stage, never a throw", async () => {
    const crash = fakeClaude({ steps: [], exitCode: 1, stderr: "boom" });
    const r = await runSystemTask({ engine: getEngine("claude"), command: crash.command, env: crash.env, prompt: "x", tools: [], handle: async () => null });
    expect(r.ok).toBe(false);
    const slow = fakeClaude({ steps: [{ sleep: 5000 }] });
    const t = await runSystemTask({ engine: getEngine("claude"), command: slow.command, env: slow.env, prompt: "x", tools: [], handle: async () => null, timeoutMs: 200 });
    expect(t.ok).toBe(false);
  });

  it("a stop ends the session as a failure", async () => {
    const slow = fakeClaude({ steps: [{ sleep: 5000 }] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const r = await runSystemTask({ engine: getEngine("claude"), command: slow.command, env: slow.env, prompt: "x", tools: [], handle: async () => null, signal: controller.signal });
    expect(r.ok).toBe(false);
  });
});
