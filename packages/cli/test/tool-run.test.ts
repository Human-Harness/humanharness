import fs from "node:fs";
import path from "node:path";
import type { runFile } from "@humanharness/shell/plugins";
import { afterAll, describe, expect, it } from "vitest";
import { CliError, UsageError } from "../src/cli";
import { TOOL_P12_NOTE } from "../src/tool-host-node";
import { type ToolRunDeps, runToolOnce, toolRunCommand } from "../src/tool-run";
import { CORE, memoryIo, memoryStream, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-tool-run-");
afterAll(cleanup);
let n = 0;

const KEY = "sk-live-0123456789abcdef";

const TOOLS: Record<string, string> = {
  echo: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Returns its arguments.",
  params: z.object({ a: z.number() }),
  returns: z.object({ a: z.number() }),
  async run(args) {
    return { a: args.a };
  },
});
`,
  fetcher: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Fetches api.example.test with the API key.",
  params: z.object({ url: z.string().optional() }),
  uses: { hosts: ["api.example.test"], secrets: ["api"] },
  async run(args, ctx) {
    const res = await ctx.fetch(args.url ?? "https://api.example.test/x", { headers: { authorization: "Bearer {{secret:api}}" } });
    return { status: res.status, text: res.text() };
  },
});
`,
  writer: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Writes note b into the notes collection.",
  params: z.object({}),
  uses: { data: { write: ["notes"] } },
  async run(_args, ctx) {
    await ctx.data.put("notes", { id: "b", text: "written" });
    return { ok: true };
  },
});
`,
  filer: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Declares it writes files.",
  params: z.object({}),
  uses: { files: "write" },
  async run() {
    return null;
  },
});
`,
  where: `import { defineTool, z } from "@humanharness/cli/tool";
export default defineTool({
  description: "Reads a file and says its scope.",
  params: z.object({ path: z.string() }),
  uses: { files: "read" },
  async run(args, ctx) {
    return { scope: ctx.scope, text: await ctx.files.read(args.path) };
  },
});
`,
};

/** A harness in a temp folder with `tools` (names from TOOLS), as tool-test.test.ts makes them. */
function harness(tools: string[]): string {
  const dir = path.join(root, `h${++n}`);
  fs.mkdirSync(path.join(dir, "agent", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", "@humanharness"), { recursive: true });
  fs.symlinkSync(path.join(CORE, "packages", "cli"), path.join(dir, "node_modules", "@humanharness", "cli"), "dir");
  fs.writeFileSync(path.join(dir, "agent", "AGENTS.md"), "# T\n\nYou try tools.\n");
  fs.writeFileSync(path.join(dir, "agent", "tasks", "look.md"), "# Task: look\n\nLook.\n");
  fs.writeFileSync(
    path.join(dir, "harness.config.ts"),
    `import { defineHarness, z } from "@humanharness/cli/sdk";
export default defineHarness({
  id: "tool-run",
  name: "Tool run",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tool run" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: true, web: true },
  blocks: {},
  actions: { look: { label: "Look", prompt: "./agent/tasks/look.md", cost: "light" } },
  path: ["look"],
  data: { notes: { scoped: false, key: "id", schema: z.object({ id: z.string(), text: z.string() }), agent: "read" } },
  tools: { ${tools.map((t) => `${t}: "./tools/${t}.ts"`).join(", ")} },
  secrets: [{ id: "api", label: "API key", help: "Any text: the tests never send it." }],
  author: "Human Harness tests",
});
`,
  );
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  for (const t of tools) fs.writeFileSync(path.join(dir, "tools", `${t}.ts`), TOOLS[t]!);
  return dir;
}

/** A folder to run in. */
function folder(files: Record<string, string> = {}): string {
  const dir = path.join(root, `f${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** Deps that reach nothing: fetch answers with the authorization header it got, commands never run. */
function fakeDeps(o: { allow?: boolean; tty?: boolean } = {}) {
  const asked: string[] = [];
  const requests: string[] = [];
  const hosts: string[] = [];
  const sent: (string | null)[] = [];
  const deps: ToolRunDeps = {
    transport: {
      fetch: (async (input: string, init?: RequestInit) => {
        requests.push(String(input));
        sent.push(new Headers(init?.headers).get("authorization"));
        return new Response(`got ${new Headers(init?.headers).get("authorization")}`, { status: 200 });
      }) as typeof fetch,
      run: (async () => {
        throw new Error("no command runs in these tests");
      }) as unknown as typeof runFile,
    },
    readSecret: async (label) => {
      asked.push(label);
      return KEY;
    },
    allowHost: async (hostname) => {
      hosts.push(hostname);
      return o.allow ?? true;
    },
    resolve: async () => null,
    isTTY: o.tty ?? true,
  };
  return { deps, asked, requests, hosts, sent };
}

const once = async (dir: string, o: { tool: string; args?: Record<string, unknown>; folder?: string; scope?: string; yes?: boolean }, deps: ToolRunDeps) => {
  const out = memoryStream();
  const code = await runToolOnce(dir, { args: {}, ...o, out: out.stream, temp: root }, deps);
  return { code, out: out.text() };
};

describe("humanharness tool run (tools spec §11, A5, A6)", () => {
  it("runs the tool once with --args and prints its result and trace", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"]);
    const { deps } = fakeDeps();
    const m = memoryIo(dir);
    expect(await toolRunCommand(["echo", "--args", '{"a":1}', "--folder", folder()], m.io, deps)).toBe(0);
    const out = m.out();
    expect(out).toContain(JSON.stringify({ a: 1 }, null, 2));
    expect(out).toMatch(/^echo · \d+ ms · ok$/m);
  });

  it("--args that aren't a JSON object are a usage error", async () => {
    const dir = harness(["echo"]);
    for (const bad of ["[1]", "x", "null", '"a"']) {
      const { deps } = fakeDeps();
      const m = memoryIo(dir);
      const err = await toolRunCommand(["echo", "--args", bad], m.io, deps).catch((e: unknown) => e);
      expect(err, bad).toBeInstanceOf(UsageError);
      expect((err as Error).message, bad).toContain("--args takes a JSON object");
      expect(m.out(), bad).toBe("");
    }
  });

  it("asks each key the tool declares, hidden, and only those", { timeout: 60_000 }, async () => {
    const dir = harness(["echo", "fetcher"]);
    const f = folder();
    const fetcher = fakeDeps();
    expect((await once(dir, { tool: "fetcher", folder: f }, fetcher.deps)).code).toBe(0);
    expect(fetcher.asked).toEqual(["API key (Any text: the tests never send it.): "]);
    const echo = fakeDeps();
    expect((await once(dir, { tool: "echo", args: { a: 1 }, folder: f }, echo.deps)).code).toBe(0);
    expect(echo.asked).toEqual([]);
  });

  it("refuses to ask keys without a terminal", { timeout: 60_000 }, async () => {
    const dir = harness(["echo", "fetcher"]);
    const f = folder();
    const { deps, asked, requests } = fakeDeps({ tty: false });
    await expect(once(dir, { tool: "fetcher", folder: f }, deps)).rejects.toThrow(new CliError("tool run asks for keys in a terminal"));
    expect(asked).toEqual([]);
    expect(requests).toEqual([]);
    // A tool with no keys runs without a terminal.
    expect((await once(dir, { tool: "echo", args: { a: 1 }, folder: f }, deps)).code).toBe(0);
  });

  it("a host that isn't public is refused before any request", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    const { deps, requests, hosts } = fakeDeps({ allow: false });
    const { code, out } = await once(dir, { tool: "fetcher", folder: folder() }, deps);
    expect(code).toBe(1);
    expect(hosts).toContain("api.example.test");
    expect(requests).toEqual([]);
    expect(out).toMatch(/^fetcher · \d+ ms · failed/m);
  });

  it("the printed trace hides the key", { timeout: 60_000 }, async () => {
    const dir = harness(["fetcher"]);
    const { deps, requests, sent } = fakeDeps();
    const { code, out } = await once(dir, { tool: "fetcher", folder: folder() }, deps);
    expect(code).toBe(0);
    // The key went out (the transport echoed it back into the result) and the terminal never shows it.
    expect(requests).toEqual(["https://api.example.test/x"]);
    expect(sent).toEqual([`Bearer ${KEY}`]);
    expect(out).toContain('"text": "got Bearer ');
    expect(out).not.toContain(KEY);
    expect(out).toContain("  fetch https://api.example.test/x allowed");
  });

  it("a tool that writes needs --yes", { timeout: 60_000 }, async () => {
    // uses.files "write" turns the app's tools off today (a later slice), so it gets a harness of its own.
    const dir = harness(["writer"]);
    const filer = harness(["filer"]);
    const f = folder();
    for (const [h, tool] of [
      [dir, "writer"],
      [filer, "filer"],
    ] as const) {
      const { deps } = fakeDeps();
      await expect(once(h, { tool, folder: f }, deps), tool).rejects.toThrow(new CliError(`This tool writes to ${f}. Add --yes to run it for real.`));
    }
    expect(fs.existsSync(path.join(f, ".harness"))).toBe(false);
    const { deps } = fakeDeps();
    const { code, out } = await once(dir, { tool: "writer", folder: f, yes: true }, deps);
    expect(code, out).toBe(0);
    expect(out).toMatch(/^writer · \d+ ms · ok$/m);
    expect(JSON.stringify(fs.readdirSync(f, { recursive: true }))).toContain("notes");
  });

  it("--folder and --scope reach ctx.files and ctx.scope", { timeout: 60_000 }, async () => {
    const dir = harness(["where"]);
    const f = folder({ "a.md": "# A\n" });
    const m = memoryIo(dir);
    const { deps } = fakeDeps();
    expect(await toolRunCommand(["where", "--args", '{"path":"a.md"}', "--folder", f, "--scope", "_app"], m.io, deps)).toBe(0);
    expect(m.out()).toContain(JSON.stringify({ scope: "_app", text: "# A\n" }, null, 2));
    const none = memoryIo(dir);
    expect(await toolRunCommand(["where", "--args", '{"path":"a.md"}', "--folder", f], none.io, fakeDeps().deps)).toBe(0);
    expect(none.out()).toContain(JSON.stringify({ scope: null, text: "# A\n" }, null, 2));
    // A folder that isn't there is refused before anything runs.
    await expect(toolRunCommand(["where", "--folder", path.join(f, "nope")], memoryIo(dir).io, fakeDeps().deps)).rejects.toBeInstanceOf(CliError);
  });

  it("prints the P12 note for tools first", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"]);
    const { out } = await once(dir, { tool: "echo", args: { a: 1 }, folder: folder() }, fakeDeps().deps);
    expect(out.startsWith(`${TOOL_P12_NOTE}\n`)).toBe(true);
    expect(out.split(TOOL_P12_NOTE)).toHaveLength(2);
  });

  it("exit 1 when the call fails", { timeout: 60_000 }, async () => {
    const dir = harness(["echo"]);
    const { code, out } = await once(dir, { tool: "echo", args: { a: "x" }, folder: folder() }, fakeDeps().deps);
    expect(code).toBe(1);
    expect(out).toMatch(/^Error: /m);
    expect(out).toMatch(/^echo · \d+ ms · failed/m);
  });

  it("D0: a harness without tools refuses; an unknown id is a usage error", { timeout: 60_000 }, async () => {
    const dir = harness([]);
    fs.writeFileSync(path.join(dir, "harness.config.ts"), fs.readFileSync(path.join(dir, "harness.config.ts"), "utf8").replace(/ {2}tools: \{[^\n]*\n/, ""));
    await expect(once(dir, { tool: "echo" }, fakeDeps().deps)).rejects.toThrow(new CliError("This harness declares no tools."));
    const other = harness(["echo"]);
    await expect(once(other, { tool: "nope" }, fakeDeps().deps)).rejects.toBeInstanceOf(UsageError);
  });
});
