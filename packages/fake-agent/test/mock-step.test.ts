import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runMockTurn } from "../src/mock-claude";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mock-step-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const PROMPT = "# Topic: the manifest\n\nPick the pull requests that need a look.";

/** A recordings folder whose one recording answers PROMPT, and where the state file would go. */
function folder() {
  const dir = fs.mkdtempSync(path.join(root, "m-"));
  const recordings = path.join(dir, "recordings");
  fs.mkdirSync(recordings);
  fs.writeFileSync(
    path.join(recordings, "manifest.json"),
    JSON.stringify({ version: 1, action: "manifest", match: "# Topic: the manifest", turns: [{ id: "t1", text: "Hola." }] }),
  );
  return { recordings, state: path.join(dir, "state", "mock.json") };
}

/** Runs one mock turn whose ui server has this env; returns the exit code and the printed stream-json lines. */
async function turn(uiEnv: Record<string, string>, env: { recordings: string; state: string }) {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
  let code: number;
  try {
    // The ui server is never started: neither turn calls a tool.
    code = await runMockTurn(["--session-id", "s-1"], PROMPT, { ui: { command: "node", args: ["nowhere.js"], env: uiEnv } }, { dir: env.recordings, state: env.state });
  } finally {
    spy.mockRestore();
  }
  return { code, lines: out.join("").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe("a recipe's AI step in mock mode (tools plan Decision 18)", () => {
  it("a step turn prints init and a success result, calls no tool and saves no session state", async () => {
    const env = folder();
    const { code, lines } = await turn({ HH_STEP: "triage", HH_JOB: "" }, env);
    expect(code).toBe(0);
    expect(lines.map((l) => l.type)).toEqual(["system", "result"]);
    expect(lines[0]).toMatchObject({ subtype: "init", session_id: "s-1", tools: [] });
    expect(lines[1]).toMatchObject({ subtype: "success", is_error: false, result: "", session_id: "s-1" });
    expect(lines[1].usage).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(fs.existsSync(env.state)).toBe(false);
  });

  it("a turn whose ui env has HH_STEP empty plays as before", async () => {
    const env = folder();
    const { code, lines } = await turn({ HH_STEP: "", HH_JOB: "" }, env);
    expect(code).toBe(0);
    expect(lines.at(-1)).toMatchObject({ type: "result", subtype: "success", result: "Hola.", session_id: "s-1" });
    expect(fs.existsSync(env.state)).toBe(true);
  });
});
