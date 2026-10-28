import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { fakeClaudeCommand, writeScript } from "../src";
import { pseudoTranslate } from "../src/pseudo";

const prompt = (batch: unknown) => `Translate.\n<batch>\n${JSON.stringify(batch)}\n</batch>\n`;

describe("pseudoTranslate (spec §9)", () => {
  it("prefixes every text, keeps placeholders and tags, writes each requested plural form", () => {
    const out = pseudoTranslate(prompt({ forms: ["few", "one", "other"], strings: { "core:a": "Start {{name}}", "core:b": "In <b>{{x}}</b>", "core:p": { one: "{{count}} item", other: "{{count}} items" } } }), "[xx]");
    expect(out).toEqual({ "core:a": "[xx] Start {{name}}", "core:b": "[xx] In <b>{{x}}</b>", "core:p": { few: "[xx] {{count}} items", one: "[xx] {{count}} item", other: "[xx] {{count}} items" } });
  });

  it("breaks the keys it is told to (drops their placeholders)", () => {
    expect(pseudoTranslate(prompt({ forms: ["other"], strings: { "core:a": "Start {{name}}" } }), "[xx]", ["core:a"])).toEqual({ "core:a": "[xx] Start" });
  });

  it("no batch: nothing", () => expect(pseudoTranslate("hello", "[xx]")).toEqual({}));

  it("a batch that is not JSON: nothing", () => expect(pseudoTranslate("<batch>{nope</batch>", "[xx]")).toEqual({}));
});

describe("fake-claude pseudoTranslate step", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pseudo-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recordServer = fileURLToPath(new URL("./fixtures/record-server.ts", import.meta.url));

  /** Runs fake-claude once with plain `steps` and the prompt on stdin; returns the recorded MCP calls. */
  const run = (text: string) =>
    new Promise<unknown[]>((resolve, reject) => {
      const record = path.join(dir, `record-${Math.random().toString(16).slice(2)}.jsonl`);
      const script = writeScript(dir, { steps: [{ pseudoTranslate: { prefix: "[zz]" } }] });
      const mcp = { mcpServers: { translate: { command: process.execPath, args: ["--import", import.meta.resolve("tsx"), recordServer], env: { HH_RECORD: record } } } };
      const [cmd, ...args] = fakeClaudeCommand();
      const env: NodeJS.ProcessEnv = { ...process.env, HH_FAKE_SCRIPT: script };
      delete env.HH_FAKE_STDIN;
      delete env.HH_FAKE_PROMPTS;
      delete env.HH_FAKE_MOCK_DIR;
      const child = spawn(cmd, [...args, "-p", "--mcp-config", JSON.stringify(mcp)], { env, stdio: ["pipe", "ignore", "inherit"] });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0) return reject(new Error(`fake-claude exited ${code}`));
        const lines = fs.existsSync(record) ? fs.readFileSync(record, "utf8") : "";
        resolve(lines.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
      });
      child.stdin.end(text);
    });

  it("reads the prompt from stdin and saves its pseudo-translation", async () => {
    const calls = await run(prompt({ forms: ["other"], strings: { "core:a": "Start {{name}}" } }));
    expect(calls).toEqual([{ tool: "save_translation", args: { strings: { "core:a": "[zz] Start {{name}}" } } }]);
  }, 30_000);

  it("saves nothing when the prompt has no batch", async () => {
    expect(await run("hello")).toEqual([]);
  }, 30_000);
});
