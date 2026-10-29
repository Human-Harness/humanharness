import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineBlock, defineHarness, hasTools, loadHarness, toolsJsonSchema, z as manifestZ } from "../src";
import { defineTool, z } from "../src/tool";

const base = {
  id: "t",
  name: "T",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/T" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: true },
  blocks: {},
  author: "x",
  actions: { study: { label: "Study", prompt: "./prompts/study.md", cost: "light" as const } },
};

describe("tools in the manifest (tools spec §3)", () => {
  it("D0: no tools key without it", () => {
    const h = defineHarness(base);
    expect("tools" in h).toBe(false);
    expect(hasTools(h)).toBe(false);
  });
  it("an empty tools map declares no tools", () => {
    expect(hasTools(defineHarness({ ...base, tools: {} }))).toBe(false);
  });
  it("maps ids to relative .ts/.js files", () => {
    const h = defineHarness({ ...base, tools: { "due-today": "./tools/due-today.ts", ci: "./tools/ci.mjs" } });
    expect(h.tools).toEqual({ "due-today": "./tools/due-today.ts", ci: "./tools/ci.mjs" });
    expect(hasTools(h)).toBe(true);
  });
  it("refuses a bad id", () => {
    expect(() => defineHarness({ ...base, tools: { Due: "./tools/a.ts" } })).toThrow();
  });
  it("refuses an absolute path and a file that is not .ts/.mts/.js/.mjs", () => {
    expect(() => defineHarness({ ...base, tools: { a: "/abs/a.ts" } })).toThrow();
    expect(() => defineHarness({ ...base, tools: { a: "./tools/a.json" } })).toThrow();
  });
  it("loadHarness refuses a tool file outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tools-"));
    try {
      const file = path.join(dir, "harness.config.mjs");
      fs.writeFileSync(file, `export default ${JSON.stringify({ ...base, tools: { a: "./../escape.ts" } })};`);
      await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ./../escape.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("refuses more than 50 tools", () => {
    const tools = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`t${i}`, `./tools/t${i}.ts`]));
    expect(() => defineHarness({ ...base, tools })).toThrow(/at most 50 tools/);
  });
  it("refuses an id that clashes with an action", () => {
    expect(() => defineHarness({ ...base, tools: { study: "./tools/a.ts" } })).toThrow(/clashes with an action/);
  });
  it("refuses an id that clashes with a job", () => {
    const jobs = { nightly: { label: "Nightly", prompt: "./prompts/n.md", on: { manual: true } } };
    expect(() => defineHarness({ ...base, jobs, tools: { nightly: "./tools/a.ts" } })).toThrow(/clashes with a job/);
  });
  it("refuses an id that clashes with a block tool name, the harness's or the core's", () => {
    const card = defineBlock({ description: "A card", visible: true, schema: manifestZ.object({ t: manifestZ.string() }), example: { t: "x" } });
    expect(() => defineHarness({ ...base, blocks: { card }, tools: { show_card: "./tools/a.ts" } })).toThrow(/clashes with a block tool/);
    expect(() => defineHarness({ ...base, tools: { job_result: "./tools/a.ts" } })).toThrow(/clashes with a block tool/);
  });
  it("refuses an id that is a core MCP server name", () => {
    for (const id of ["ui", "data", "translate", "review", "material", "tools"]) {
      expect(() => defineHarness({ ...base, tools: { [id]: "./tools/a.ts" } })).toThrow(/core MCP server/);
    }
  });
});

describe("defineTool (tools spec §3.1)", () => {
  it("defaults agent to call and uses to none, and keeps the definition", () => {
    const run = async () => 1;
    const t = defineTool({ description: "Counts the notes in the folder by month.", params: z.object({}), run });
    expect(t.agent).toBe("call");
    expect(t.uses).toEqual({});
    expect(t.run).toBe(run);
    expect(t.description).toBe("Counts the notes in the folder by month.");
  });
  it("keeps an explicit agent and uses", () => {
    const t = defineTool({ description: "x".repeat(30), params: z.object({}), agent: "none", uses: { hosts: ["api.github.com"] }, run: async () => 1 });
    expect(t.agent).toBe("none");
    expect(t.uses).toEqual({ hosts: ["api.github.com"] });
  });
  it("accepts a timeout of 1 and of 120 seconds", () => {
    expect(defineTool({ description: "x".repeat(30), params: z.object({}), timeout: 1, run: async () => 1 }).timeout).toBe(1);
    expect(defineTool({ description: "x".repeat(30), params: z.object({}), timeout: 120, run: async () => 1 }).timeout).toBe(120);
  });
  it("refuses a timeout outside 1–120 seconds or not whole", () => {
    for (const timeout of [0, 121, 1.5]) {
      expect(() => defineTool({ description: "x".repeat(30), params: z.object({}), timeout, run: async () => 1 })).toThrow(/1 to 120/);
    }
  });
});

describe("tools.json (tools spec §3.2)", () => {
  const ok = {
    version: 1,
    tools: {
      "due-today": {
        description: "Reviews due today and the next concept.",
        agent: "call",
        uses: { data: { read: ["cards"] } },
        params: { type: "object", properties: {} },
        returns: { type: "array", items: { type: "object", properties: {} } },
        timeout: 30,
        file: "tools/due-today.js",
      },
    },
  };
  it("accepts one entry per tool with JSON Schemas", () => {
    expect(toolsJsonSchema.parse(ok).tools["due-today"].agent).toBe("call");
  });
  it("refuses unknown keys at the top, in an entry and in uses", () => {
    expect(() => toolsJsonSchema.parse({ ...ok, extra: 1 })).toThrow();
    expect(() => toolsJsonSchema.parse({ ...ok, tools: { "due-today": { ...ok.tools["due-today"], extra: 1 } } })).toThrow();
    expect(() => toolsJsonSchema.parse({ ...ok, tools: { "due-today": { ...ok.tools["due-today"], uses: { net: true } } } })).toThrow();
  });
  it("refuses another version, a file outside tools/ and a timeout over 120", () => {
    expect(() => toolsJsonSchema.parse({ ...ok, version: 2 })).toThrow();
    expect(() => toolsJsonSchema.parse({ ...ok, tools: { "due-today": { ...ok.tools["due-today"], file: "../x.js" } } })).toThrow();
    expect(() => toolsJsonSchema.parse({ ...ok, tools: { "due-today": { ...ok.tools["due-today"], timeout: 121 } } })).toThrow();
  });
  it("refuses more than 50 tools", () => {
    const entry = (id: string) => ({ ...ok.tools["due-today"], file: `tools/${id}.js` });
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, entry(`t${i}`)]));
    expect(toolsJsonSchema.safeParse({ version: 1, tools: many(50) }).success).toBe(true);
    expect(toolsJsonSchema.safeParse({ version: 1, tools: many(51) }).success).toBe(false);
  });
  it("caps every uses string and list, never echoing a long value in its message", () => {
    const withUses = (uses: unknown) => ({ ...ok, tools: { "due-today": { ...ok.tools["due-today"], uses } } });
    const huge = "x".repeat(10_000);
    const refused = (uses: unknown) => {
      const r = toolsJsonSchema.safeParse(withUses(uses));
      expect(r.success, JSON.stringify(uses).slice(0, 80)).toBe(false);
      if (!r.success) expect(r.error.message).not.toContain("x".repeat(300));
    };
    // A long but sane value of each kind still passes: the caps match the manifest's own limits.
    const fine = {
      hosts: Array.from({ length: 20 }, (_, i) => `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.example${i}.com:65535`),
      secrets: Array.from({ length: 10 }, (_, i) => `k${i}${"a".repeat(38)}`),
      exec: Array.from({ length: 10 }, () => ({ cmd: "g".repeat(64), args: Array.from({ length: 20 }, () => "a".repeat(200)) })),
      data: { read: Array.from({ length: 50 }, (_, i) => `c${i}${"a".repeat(37)}`), write: [`c${"a".repeat(39)}`] },
    };
    expect(toolsJsonSchema.safeParse(withUses(fine)).success).toBe(true);
    refused({ hosts: [huge] });
    refused({ hosts: Array.from({ length: 21 }, () => "a.com") });
    refused({ secrets: [huge] });
    refused({ secrets: Array.from({ length: 11 }, (_, i) => `k${i}`) });
    refused({ exec: [{ cmd: huge, args: [] }] });
    refused({ exec: [{ cmd: "git", args: [huge] }] });
    refused({ exec: [{ cmd: "git", args: Array.from({ length: 21 }, () => "a") }] });
    refused({ exec: Array.from({ length: 11 }, () => ({ cmd: "git", args: [] })) });
    refused({ data: { read: [huge] } });
    refused({ data: { write: [huge] } });
    refused({ data: { read: Array.from({ length: 51 }, (_, i) => `c${i}`) } });
    refused({ data: { write: Array.from({ length: 51 }, (_, i) => `c${i}`) } });
  });
});
