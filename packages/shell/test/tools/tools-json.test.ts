import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta, ToolsManifest } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NOT_BUILT, TOOLS_JSON_MAX_BYTES, readToolsJson } from "../../src/main/tools/tools-json";

let root: string;
let logs: string[];
const log = (m: string) => void logs.push(m);

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-json-")));
  logs = [];
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const manifest = (tools: Record<string, string>): ToolsManifest => ({ permissions: { edit: "folder", exec: false, web: true }, data: {}, tools });

function meta(id: string, over: Partial<ToolMeta> = {}): ToolMeta {
  return {
    description: "Counts the notes of the open scope",
    agent: "call",
    uses: {},
    params: { type: "object", properties: {} },
    timeout: 30,
    file: `tools/${id}.js`,
    ...over,
  };
}

async function writeJson(value: unknown): Promise<void> {
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(path.join(root, "dist", "tools.json"), typeof value === "string" ? value : JSON.stringify(value));
}

describe("readToolsJson (tools spec §3.2, Decision 3)", () => {
  it("reads dist/tools.json, parses it and runs toolProblems: tools on", async () => {
    await writeJson({ version: 1, tools: { "count-notes": meta("count-notes") } });
    const s = await readToolsJson(root, manifest({ "count-notes": "./tools/count-notes.ts" }), log);
    expect(s).toEqual({ on: true, tools: { "count-notes": meta("count-notes") } });
    expect(logs).toEqual([]);
  });

  it("missing: off with 'Tools are not built: run humanharness build'", async () => {
    const s = await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log);
    expect(s).toEqual({ on: false, reason: NOT_BUILT });
    expect(NOT_BUILT).toBe("Tools are not built: run humanharness build");
    expect(logs).toHaveLength(1);
  });

  it("not JSON, or not tools.json's shape: off as not built, with why logged once", async () => {
    await writeJson("{ nope");
    expect(await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log)).toEqual({ on: false, reason: NOT_BUILT });
    await writeJson({ version: 2, tools: {} });
    expect(await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log)).toEqual({ on: false, reason: NOT_BUILT });
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatch(/version/);
  });

  it("a problem: off with its message", async () => {
    await writeJson({ version: 1, tools: { a: meta("a", { uses: { exec: [{ cmd: "gh", args: [] }] } }) } });
    const s = await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log);
    expect(s).toEqual({ on: false, reason: "a: uses.exec needs permissions.exec" });
    expect(logs).toEqual(["Tools are off: a: uses.exec needs permissions.exec"]);
  });

  it("a tool in the manifest missing from tools.json: off", async () => {
    await writeJson({ version: 1, tools: { a: meta("a") } });
    const s = await readToolsJson(root, manifest({ a: "./tools/a.ts", b: "./tools/b.ts" }), log);
    expect(s).toEqual({ on: false, reason: "b: not built (run humanharness build)" });
  });

  it("an entry whose file is another tool's bundle: off (a's grant never runs b's code)", async () => {
    await writeJson({ version: 1, tools: { a: meta("a", { file: "tools/b.js" }), b: meta("b") } });
    const s = await readToolsJson(root, manifest({ a: "./tools/a.ts", b: "./tools/b.ts" }), log);
    expect(s).toEqual({ on: false, reason: 'a: file is "tools/b.js", not "tools/a.js" (run humanharness build)' });
  });

  it("over 1 MB: off, unread", async () => {
    await writeJson(" ".repeat(TOOLS_JSON_MAX_BYTES + 1));
    expect(await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log)).toEqual({ on: false, reason: NOT_BUILT });
    expect(logs[0]).toMatch(/too large/);
  });

  it("a link at dist/tools.json or at dist/ is refused (no link, O_NOFOLLOW)", async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-json-out-")));
    try {
      await fs.writeFile(path.join(outside, "tools.json"), JSON.stringify({ version: 1, tools: { a: meta("a") } }));
      await fs.mkdir(path.join(root, "dist"));
      await fs.symlink(path.join(outside, "tools.json"), path.join(root, "dist", "tools.json"));
      expect(await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log)).toEqual({ on: false, reason: NOT_BUILT });
      await fs.rm(path.join(root, "dist"), { recursive: true });
      await fs.symlink(outside, path.join(root, "dist"));
      expect(await readToolsJson(root, manifest({ a: "./tools/a.ts" }), log)).toEqual({ on: false, reason: NOT_BUILT });
      expect(logs).toHaveLength(2);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("more than TOOLS_MAX tools: off", async () => {
    const tools = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`t${i}`, meta(`t${i}`)]));
    await writeJson({ version: 1, tools });
    const s = await readToolsJson(root, manifest(Object.fromEntries(Object.keys(tools).map((id) => [id, `./tools/${id}.ts`]))), log);
    expect(s).toEqual({ on: false, reason: NOT_BUILT });
    expect(logs[0]).toMatch(/at most 50 tools/);
  });
});
