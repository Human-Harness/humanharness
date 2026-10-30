import { describe, expect, it } from "vitest";
import { type Harness, type ToolMeta, type ToolsJson, defineHarness, toolProblems, z } from "../src";

const base = {
  id: "t",
  name: "T",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/T" },
  instructions: "./AGENTS.md",
  blocks: {},
  author: "x",
  actions: { study: { label: "Study", prompt: "./prompts/study.md", cost: "light" as const } },
  data: { tasks: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "read" as const } },
  secrets: [{ id: "github", label: "GitHub token" }],
  tools: { "due-today": "./tools/due-today.ts" },
};

const meta = (over: Partial<ToolMeta> = {}): ToolMeta => ({
  description: "Lists the tasks due today, oldest first.",
  agent: "call",
  uses: {},
  params: { type: "object", properties: {} },
  timeout: 30,
  file: "tools/due-today.js",
  ...over,
});

const manifest = (perms: Partial<Harness["permissions"]> = {}, over: Record<string, unknown> = {}): Harness =>
  defineHarness({ ...base, permissions: { edit: "folder", exec: true, web: true, ...perms }, ...over } as Parameters<typeof defineHarness>[0]);

/** The messages for one tool "due-today" with these `uses` (and meta fields), in a harness with these permissions. */
const msgs = (perms: Partial<Harness["permissions"]>, uses: ToolMeta["uses"], over: Partial<ToolMeta> = {}): string[] =>
  toolProblems(manifest(perms), { version: 1, tools: { "due-today": meta({ uses, ...over }) } }).map((p) => p.message);

describe("toolProblems (tools spec §3.3)", () => {
  it("a tool that uses what the harness allows has no problem", () => {
    expect(
      msgs({}, { hosts: ["api.github.com", "*.atlassian.net:443"], secrets: ["github"], exec: [{ cmd: "gh", args: ["pr", "*"] }], data: { read: ["tasks"], write: ["tasks"] }, files: "read" }),
    ).toEqual([]);
  });
  it("each problem names its tool", () => {
    const json: ToolsJson = { version: 1, tools: { "due-today": meta({ uses: { files: "write" } }) } };
    expect(toolProblems(manifest(), json)).toEqual([{ tool: "due-today", message: "due-today: uses.files: write comes in a later slice; use read" }]);
  });
  it("hosts need permissions.web", () => {
    expect(msgs({ web: false }, { hosts: ["api.x.com"] })).toContain("due-today: uses.hosts needs permissions.web");
  });
  it("exec needs permissions.exec", () => {
    expect(msgs({ exec: false }, { exec: [{ cmd: "gh", args: ["*"] }] })).toContain("due-today: uses.exec needs permissions.exec");
  });
  it("files: read is fine; files: write is refused for now", () => {
    expect(msgs({}, { files: "read" })).toEqual([]);
    expect(msgs({}, { files: "write" })).toContain("due-today: uses.files: write comes in a later slice; use read");
  });
  it("data names collections that exist; write ones too", () => {
    expect(msgs({}, { data: { write: ["nope"] } })).toContain('due-today: uses.data.write: "nope" is not a collection');
    expect(msgs({}, { data: { read: ["gone"] } })).toContain('due-today: uses.data.read: "gone" is not a collection');
    expect(msgs({}, { data: { read: ["toString", "__proto__"] } })).toEqual([
      'due-today: uses.data.read: "toString" is not a collection',
      'due-today: uses.data.read: "__proto__" is not a collection',
    ]);
  });
  it("secrets name declared secrets", () => {
    expect(msgs({}, { secrets: ["jira"] })).toContain('due-today: uses.secrets: "jira" is not declared in secrets');
    const none = toolProblems(manifest({}, { secrets: undefined }), { version: 1, tools: { "due-today": meta({ uses: { secrets: ["github"] } }) } });
    expect(none.map((p) => p.message)).toEqual(['due-today: uses.secrets: "github" is not declared in secrets']);
  });
  it("hosts and exec use the plugin patterns (HOST_PATTERN, bare cmd, * last)", () => {
    expect(msgs({ web: true }, { hosts: ["https://x.com"] })).toContain('due-today: uses.hosts: "https://x.com" is not a host pattern');
    expect(msgs({}, { hosts: ["API.x.com"] })).toContain('due-today: uses.hosts: "API.x.com" is not a host pattern');
    expect(msgs({}, { exec: [{ cmd: "/usr/bin/gh", args: [] }] })).toContain('due-today: uses.exec: "/usr/bin/gh" is not a bare command name');
    expect(msgs({}, { exec: [{ cmd: "gh", args: ["*", "x"] }] })).toContain('due-today: uses.exec: "gh": * can only be the last token');
    expect(msgs({}, { exec: [{ cmd: "curl", args: ["{{secret:github}}"] }] })).toContain('due-today: uses.exec: "curl": Secrets never go into a command');
  });
  it("hosts are public host names: localhost and IP literals are refused (the broker refuses them at call time too)", () => {
    for (const h of ["localhost", "localhost:8080", "a.localhost", "*.a.localhost", "127.0.0.1", "10.0.0.1:443", "*.0.0.1", "2130706433", "127.1", "0x7f.1"]) {
      expect(msgs({}, { hosts: [h] })).toEqual([`due-today: uses.hosts: "${h}" is not a public host name`]);
    }
    expect(msgs({}, { hosts: ["api.github.com", "localhost.example.com", "1password.com", "x.1a", "intranet"] })).toEqual([]);
  });
  it("an agent: call tool has a description of at least 20 characters that is not its id", () => {
    const text = "due-today: an agent: call tool needs a description of at least 20 characters that says what it does";
    expect(msgs({}, {}, { description: "due-today" })).toContain(text);
    expect(msgs({}, {}, { description: "Lists today's tasks" })).toContain(text);
    expect(msgs({}, {}, { description: "Lists the tasks due." })).toEqual([]);
    // An id of 20 characters or more is still just its id.
    const long = "list-every-task-due-today";
    const json: ToolsJson = { version: 1, tools: { [long]: meta({ description: ` ${long} `, file: `tools/${long}.js` }) } };
    expect(toolProblems(manifest({}, { tools: { [long]: `./tools/${long}.ts` } }), json).map((p) => p.message)).toEqual([
      `${long}: an agent: call tool needs a description of at least 20 characters that says what it does`,
    ]);
    // An agent: "none" tool never reaches the agent: a short description is fine.
    expect(msgs({}, {}, { agent: "none", description: "due-today" })).toEqual([]);
  });
  it("an entry runs its own bundle: file is tools/<id>.js", () => {
    expect(msgs({}, {}, { file: "tools/other.js" })).toEqual(['due-today: file is "tools/other.js", not "tools/due-today.js" (run humanharness build)']);
  });
  it("the manifest and tools.json list the same ids", () => {
    const missing = toolProblems(manifest(), { version: 1, tools: {} });
    expect(missing).toEqual([{ tool: "due-today", message: "due-today: not built (run humanharness build)" }]);
    const extra = toolProblems(manifest(), { version: 1, tools: { "due-today": meta(), old: meta({ file: "tools/old.js" }) } });
    expect(extra).toEqual([{ tool: "old", message: "old: not a tool of this harness (run humanharness build)" }]);
    const none = toolProblems(manifest({}, { tools: undefined }), { version: 1, tools: { "due-today": meta() } });
    expect(none.map((p) => p.message)).toEqual(["due-today: not a tool of this harness (run humanharness build)"]);
  });
});
