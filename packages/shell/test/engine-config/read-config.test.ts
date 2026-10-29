import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readEngineConfig } from "../../src/main/engine-config/read-config";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-read-config-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let n = 0;
/** A person's folder with `files` under its `.harness/engine/s/`; `extra` goes at the folder's top. */
function setup(files: Record<string, string | Buffer>, extra: Record<string, string> = {}) {
  const folder = path.join(root, `w${++n}`);
  const dir = path.join(folder, ".harness", "engine", "s");
  fs.mkdirSync(dir, { recursive: true });
  const write = (base: string, rel: string, data: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), data);
  };
  for (const [rel, data] of Object.entries(files)) write(dir, rel, data);
  for (const [rel, data] of Object.entries(extra)) write(folder, rel, data);
  const o = { folder, linked: [] as string[], edit: "folder" as const, reserved: new Set(["ui", "data", "translate", "review"]), actions: { review: {} } };
  return { folder, dir, o, read: () => readEngineConfig(dir, o) };
}

const SKILL = "---\nname: fmt\ndescription: Formats files\n---\nRun the formatter.\n";
const AGENT = "---\ndescription: Reviews changes\ntools: [Read, Grep]\npermissionMode: plan\n---\nYou review.\n";

describe("readEngineConfig (spec §5.1–5.4)", () => {
  it("an absent or empty folder is null (D0 for the scope)", async () => {
    const { o, dir, read } = setup({});
    expect(await read()).toBeNull();
    expect(await readEngineConfig(path.join(dir, "..", "missing"), o)).toBeNull();
    fs.mkdirSync(path.join(dir, "skills"));
    expect(await read()).toBeNull();
  });

  it("reads base, instructions, mcp, settings, skills, agents, codex and an action layer", async () => {
    const { read } = setup({
      base: "global\n",
      "instructions.md": "Use tabs.\n",
      "mcp.json": JSON.stringify({ mcpServers: { lint: { command: "npx", args: ["-y", "lint-mcp@1.0"] } } }),
      "settings.json": JSON.stringify({ defaultMode: "bypassPermissions", permissions: { allow: ["Bash(npm test)"] } }),
      "skills/fmt/SKILL.md": SKILL,
      "skills/fmt/helper.txt": "notes",
      "agents/reviewer.md": AGENT,
      "codex.toml": 'model_verbosity = "low"\nhide_agent_reasoning = true\n',
      "actions/review/instructions.md": "Be strict.",
      "actions/review/mcp.json": JSON.stringify({ mcpServers: { diff: { command: "uvx", args: ["mcp-diff"] } } }),
      "actions/review/settings.json": JSON.stringify({ permissions: { deny: ["Bash(git push:*)"] } }),
    });
    const c = (await read())!;
    expect(c.refusals).toEqual([]);
    expect(c.base).toBe("global");
    expect(c.instructions).toBe("Use tabs.\n");
    expect(c.servers).toEqual([{ name: "scope-lint", command: "npx", args: ["-y", "lint-mcp@1.0"], env: {} }]);
    expect(c.settings).toEqual({ permissions: { allow: ["Bash(npm test)"] } });
    expect(c.skills).toEqual([{ name: "fmt", description: "Formats files" }]);
    expect(c.agents).toEqual({ reviewer: { description: "Reviews changes", prompt: "You review.", tools: ["Read", "Grep"] } });
    expect(c.codex).toEqual({ model_verbosity: "low", hide_agent_reasoning: true });
    expect(c.ignored).toEqual(["settings.json: defaultMode", "agents/reviewer.md: permissionMode"]);
    expect(c.actions).toEqual({
      review: {
        instructions: "Be strict.",
        servers: [{ name: "scope-diff", command: "uvx", args: ["mcp-diff"], env: {} }],
        settings: { permissions: { deny: ["Bash(git push:*)"] } },
        ignored: [],
      },
    });
    expect(c.scripts).toEqual([]);
    expect([...c.files.keys()].sort()).toEqual([
      "actions/review/instructions.md",
      "actions/review/mcp.json",
      "actions/review/settings.json",
      "agents/reviewer.md",
      "base",
      "codex.toml",
      "instructions.md",
      "mcp.json",
      "settings.json",
      "skills/fmt/SKILL.md",
      "skills/fmt/helper.txt",
    ]);
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("base defaults to isolated; a base other than isolated/global is a refusal", async () => {
    const plain = (await setup({ "instructions.md": "x" }).read())!;
    expect(plain.base).toBe("isolated");
    expect(plain.settings).toBeNull();
    expect(plain.codex).toBeNull();
    expect(plain.servers).toEqual([]);
    expect(plain.actions).toEqual({});
    const bad = (await setup({ base: "everything" }).read())!;
    expect(bad.base).toBe("isolated");
    expect(bad.refusals).toEqual([{ file: "base", message: 'base: must be "isolated" or "global"' }]);
  });

  it("a JSON file that repeats a key is refused naming it (one server name twice)", async () => {
    const c = (await setup({
      "mcp.json": '{"mcpServers":{"lint":{"command":"node"},"lint":{"command":"sh"}}}',
      "actions/review/settings.json": '{"permissions":{"deny":[],"deny":["x"]}}',
    }).read())!;
    expect(c.refusals).toEqual([
      { file: "actions/review/settings.json", message: "actions/review/settings.json: permissions.deny is repeated" },
      { file: "mcp.json", message: "mcp.json: mcpServers.lint is repeated" },
    ]);
    expect(c.servers).toEqual([]);
  });

  it("refusals are collected with the file and key, not thrown", async () => {
    const c = (await setup({
      "settings.json": JSON.stringify({ env: { A: "1" } }),
      "mcp.json": "{ not json",
      "codex.toml": "model_provider = \"x\"\n",
      "agents/bad.md": "---\ndescription: d\nhooks: x\n---\n",
      "skills/fmt/SKILL.md": "---\nname: fmt\nhooks: x\ndescription: d\n---\n",
      "actions/review/settings.json": JSON.stringify({ apiKeyHelper: "x" }),
      "actions/nope/instructions.md": "x",
    }).read())!;
    expect(c.refusals).toEqual([
      { file: "actions/nope", message: "actions/nope: nope is not an action of this harness" },
      { file: "actions/review/settings.json", message: "actions/review/settings.json: apiKeyHelper is not allowed" },
      { file: "agents/bad.md", message: "agents/bad.md: hooks is not allowed" },
      { file: "codex.toml", message: "codex.toml: model_provider is not allowed" },
      { file: "mcp.json", message: "mcp.json: is not valid JSON" },
      { file: "settings.json", message: "settings.json: env is not allowed" },
      { file: "skills/fmt/SKILL.md", message: "skills/fmt/SKILL.md: hooks is not allowed" },
    ]);
    expect(c.settings).toBeNull();
    expect(c.agents).toEqual({});
    expect(c.skills).toEqual([]);
  });

  it("codex.toml keys that reach the network pass only when the manifest allows the web", async () => {
    const { dir, o } = setup({ "codex.toml": "[tools]\nweb_search = true\n" });
    const off = (await readEngineConfig(dir, o))!;
    expect(off.codex).toBeNull();
    expect(off.refusals.map((r) => r.message)).toEqual(["codex.toml: tools.web_search is not allowed: the harness doesn't allow the web"]);
    const on = (await readEngineConfig(dir, { ...o, web: true }))!;
    expect(on.refusals).toEqual([]);
    expect(on.codex).toEqual({ tools: { web_search: true } });
  });

  it("a codex.toml parse error names the file and line", async () => {
    const c = (await setup({ "codex.toml": "a = 1\nb = \n" }).read())!;
    expect(c.refusals).toHaveLength(1);
    expect(c.refusals[0]!.file).toBe("codex.toml");
    expect(c.refusals[0]!.message).toMatch(/^codex\.toml: line 2: /);
  });

  it("the hash covers every file, action layers included", async () => {
    const { dir, read } = setup({ "instructions.md": "a", "actions/review/instructions.md": "b", "skills/fmt/SKILL.md": SKILL });
    const h1 = (await read())!.hash;
    expect((await read())!.hash).toBe(h1);
    const layer = path.join(dir, "actions/review/instructions.md");
    fs.writeFileSync(layer, "c");
    const h2 = (await read())!.hash;
    expect(h2).not.toBe(h1);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(layer, later, later);
    expect((await read())!.hash).toBe(h2);
    fs.writeFileSync(path.join(dir, "skills/fmt/extra.md"), "more");
    expect((await read())!.hash).not.toBe(h2);
  });

  it("a change to a referenced script changes the hash (E2)", async () => {
    const hooks = { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/check.js' }] }] };
    const { folder, read } = setup(
      { "settings.json": JSON.stringify({ hooks }), "mcp.json": JSON.stringify({ mcpServers: { lint: { command: "node", args: ["./tools/lint.js"] } } }) },
      { "tools/check.js": "one", "tools/lint.js": "lint" },
    );
    const c1 = (await read())!;
    expect(c1.scripts).toEqual([path.join(folder, "tools/check.js"), path.join(folder, "tools/lint.js")]);
    expect(c1.scriptFiles.get(path.join(folder, "tools/check.js"))?.toString()).toBe("one");
    fs.writeFileSync(path.join(folder, "tools/check.js"), "two");
    const c2 = (await read())!;
    expect(c2.hash).not.toBe(c1.hash);
    fs.writeFileSync(path.join(folder, "tools/lint.js"), "lint 2");
    expect((await read())!.hash).not.toBe(c2.hash);
  });

  it.each([
    ["a symbolic link", "is a symbolic link"],
    ["a folder", "is a folder"],
  ])("a command naming %s in the folder is refused naming it (E2, E8)", async (kind, why) => {
    const hooks = { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/run.js' }] }] };
    const { folder, read } = setup({ "settings.json": JSON.stringify({ hooks }) }, { "tools/real.js": "one" });
    const run = path.join(folder, "tools/run.js");
    if (kind === "a folder") fs.mkdirSync(run);
    else fs.symlinkSync(path.join(folder, "tools/real.js"), run);
    const c = (await read())!;
    expect(c.refusals).toEqual([{ file: run, message: `${run}: ${why}, named by ${JSON.stringify('node "$CLAUDE_PROJECT_DIR"/tools/run.js')}; a command must name a plain script file` }]);
    expect(c.scriptFiles.size).toBe(0);
  });

  it("codex.toml hooks and action-layer servers join the scripts too", async () => {
    const { folder, dir, read } = setup(
      { "actions/review/mcp.json": JSON.stringify({ mcpServers: { x: { command: "./b.sh" } } }) },
      { "a.sh": "a", "b.sh": "#!/bin/sh\nb" },
    );
    // Codex sets no CLAUDE_PROJECT_DIR: its hooks name absolute paths.
    fs.writeFileSync(path.join(dir, "codex.toml"), `[[hooks.Stop]]\nhooks = [{ type = "command", command = "sh ${folder}/a.sh" }]\n`);
    const c = (await read())!;
    expect(c.refusals).toEqual([]);
    expect(c.scripts).toEqual([path.join(folder, "a.sh"), path.join(folder, "b.sh")]);
  });

  it("hook and server commands outside the grammar are refused naming the config file (E2)", async () => {
    const hook = (command: string) => ({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } });
    const { read } = setup({
      "settings.json": JSON.stringify(hook("cd tools && node x.js")),
      "codex.toml": '[[hooks.Stop]]\nhooks = [{ type = "command", command = "node $HOME/x.js" }]\n',
      "mcp.json": JSON.stringify({ mcpServers: { lint: { command: "sh", args: ["-c", "node ./x.js"] } } }),
    });
    const c = (await read())!;
    const form = ": a hook or server must run a plain script file: <interpreter> <script> [args]";
    expect(c.refusals).toEqual([
      { file: "codex.toml", message: `codex.toml: the hook command "node $HOME/x.js" uses "$"${form}` },
      { file: "mcp.json", message: `mcp.json: the server lint "sh -c node ./x.js" gives sh an option (-c)${form}` },
      { file: "settings.json", message: `settings.json: the hook command "cd tools && node x.js" uses "&"${form}` },
    ]);
  });

  it("a script under $CLAUDE_PROJECT_DIR joins the hash", async () => {
    const hooks = { Stop: [{ hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR"/tools/x.js` }] }] };
    const { folder, read } = setup({ "settings.json": JSON.stringify({ hooks }) }, { "tools/x.js": "one" });
    const c1 = (await read())!;
    expect(c1.refusals).toEqual([]);
    expect(c1.scripts).toEqual([path.join(folder, "tools/x.js")]);
    fs.writeFileSync(path.join(folder, "tools/x.js"), "two");
    expect((await read())!.hash).not.toBe(c1.hash);
  });

  it.each([
    ["an allowed line at the scan, a bad one when hashed", "#!/bin/sh\n", "#!/bin/sh -x\n", true],
    ["a bad line at the scan, an allowed one when hashed", "#!/bin/sh -x\n", "#!/bin/sh\n", false],
  ])("the #! line is judged on the bytes hashed: %s", async (_case, first, then, refused) => {
    const { folder, read } = setup({ "mcp.json": JSON.stringify({ mcpServers: { srv: { command: "./tools/srv.sh" } } }) }, { "tools/srv.sh": first });
    const script = path.join(folder, "tools/srv.sh");
    // The agent rewrites the script after anything the scan may read, just before the read for the hash: any first
    // line judged on an earlier read would be `first`, the one that runs is `then`.
    const open = fsp.open;
    const spy = vi.spyOn(fsp, "open").mockImplementation(async (p, ...rest) => {
      if (p === script && new Error().stack?.includes("readRegular")) fs.writeFileSync(script, then);
      return (open as (...a: unknown[]) => Promise<never>)(p, ...rest);
    });
    try {
      const c = (await read())!;
      expect(c.scriptFiles.get(script)?.toString()).toBe(then);
      expect(spy).toHaveBeenCalled();
      expect(c.refusals.some((r) => r.file === script && r.message.includes("no allowed #! line"))).toBe(refused);
    } finally {
      spy.mockRestore();
    }
  });

  it("a file in the engine folder the hash skips (.DS_Store) is refused when a command runs it (probe 5)", async () => {
    const { dir, read } = setup({
      ".DS_Store": "console.log('approved')\n",
      "settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/.harness/engine/s/.DS_Store' }] }] } }),
      "mcp.json": JSON.stringify({ mcpServers: { x: { command: "python3", args: [".harness/engine/s/.DS_Store"] } } }),
    });
    const c = (await read())!;
    expect(c.files.has(".DS_Store")).toBe(false);
    expect(c.refusals.map((r) => [r.file, r.message.includes("none of the files its hash covers")])).toEqual([[path.join(dir, ".DS_Store"), true]]);
  });

  it.each([".harness/engine/s/skills/k/run", ".harness/Engine/s/skills/k/run", ".HARNESS/engine/S/skills/k/run"])(
    "a script in the engine folder named with another case is judged on the engine folder's bytes: %s (probe 5)",
    async (p) => {
      const { folder, dir, read } = setup({ "skills/k/SKILL.md": "---\ndescription: k\n---\nbody\n" });
      fs.writeFileSync(path.join(dir, "skills/k/run"), `#!${folder}/tools/interp\necho hashed body\n`);
      const hook = { hooks: { Stop: [{ hooks: [{ type: "command", command: `"$CLAUDE_PROJECT_DIR"/${p}` }] }] } };
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(hook));
      const c = (await read())!;
      expect(c.refusals.map((r) => r.message)).toEqual([expect.stringContaining("starts with no allowed #! line")]);
      expect(c.scripts).toEqual([]);
      // A server, by a relative path.
      fs.rmSync(path.join(dir, "settings.json"));
      fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: { x: { command: p } } }));
      expect((await read())!.refusals.map((r) => r.message)).toEqual([expect.stringContaining("starts with no allowed #! line")]);
    },
  );

  it("a #! line padded past what was once read is judged whole (probe 5)", async () => {
    const { folder, dir, read } = setup({}, { "tools/evil.sh": "echo evil\n" });
    fs.writeFileSync(path.join(folder, "tools/run"), "#!/bin/sh" + " ".repeat(260) + `${folder}/tools/evil.sh\necho hashed\n`);
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/tools/run' }] }] } }));
    expect((await read())!.refusals.map((r) => r.message)).toEqual([expect.stringContaining("over 127 bytes")]);
  });

  it("a bare interpreter, npx, uvx or #!/usr/bin/env interpreter found first on PATH inside a root is refused (probe 5)", async () => {
    const { folder, dir, o, read } = setup({}, { "bin/node": "evil", "bin/npx": "evil", "bin/sh": "evil", "tools/x.js": "x", "tools/run": "#!/usr/bin/env sh\necho\n" });
    for (const b of ["node", "npx", "sh"]) fs.chmodSync(path.join(folder, "bin", b), 0o755);
    const run = async (mcp: unknown, searchPath?: string) => {
      fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify(mcp));
      return (await readEngineConfig(dir, { ...o, ...(searchPath ? { searchPath } : {}) }))!.refusals.map((r) => r.message);
    };
    const onPath = `${folder}/bin:/usr/bin:/bin`;
    for (const mcp of [
      { mcpServers: { x: { command: "node", args: ["./tools/x.js"] } } },
      { mcpServers: { x: { command: "npx", args: ["-y", "srv"] } } },
      { mcpServers: { x: { command: "./tools/run" } } },
    ]) {
      expect(await run(mcp, onPath), JSON.stringify(mcp)).toEqual([expect.stringContaining("found first on PATH")]);
      expect(await run(mcp, "/usr/bin:/bin"), JSON.stringify(mcp)).toEqual([]);
    }
    expect((await read())!.refusals).toEqual([]);
  });

  it("refuses hard links, in the engine folder and as scripts", async () => {
    const hooks = { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/x.js' }] }] };
    const { folder, dir, read } = setup({ "settings.json": JSON.stringify({ hooks }) }, { "tools/x.js": "x", "secret.json": "s" });
    fs.linkSync(path.join(folder, "secret.json"), path.join(dir, "instructions.md"));
    fs.linkSync(path.join(folder, "tools/x.js"), path.join(folder, "x-again.js"));
    const c = (await read())!;
    expect(c.refusals).toEqual([
      { file: path.join(folder, "tools/x.js"), message: `${path.join(folder, "tools/x.js")}: the script has hard links, which are not allowed` },
      { file: "instructions.md", message: "instructions.md: hard links are not allowed" },
    ]);
    expect(c.files.has("instructions.md")).toBe(false);
    expect(c.scripts).toEqual([]);
  });

  it("refuses symlinks, files over 256 KB, more than 200 files, depth over 4 (E8)", async () => {
    const link = setup({ "instructions.md": "x" }, { "secret.txt": "s" });
    fs.symlinkSync(path.join(link.folder, "secret.txt"), path.join(link.dir, "settings.json"));
    const l = (await link.read())!;
    expect(l.refusals).toEqual([{ file: "settings.json", message: "settings.json: symbolic links are not allowed" }]);
    expect(l.files.has("settings.json")).toBe(false);

    const big = (await setup({ "instructions.md": Buffer.alloc(256 * 1024 + 1, 97) }).read())!;
    expect(big.refusals).toEqual([{ file: "instructions.md", message: "instructions.md: is over 256 KB" }]);
    expect(big.files.has("instructions.md")).toBe(false);

    const many: Record<string, string> = {};
    for (let i = 0; i < 201; i++) many[`skills/fmt/f${i}.txt`] = "x";
    const m = (await setup({ ...many, "skills/fmt/SKILL.md": SKILL }).read())!;
    expect(m.refusals.map((r) => r.message)).toContain("the engine folder has more than 200 files");

    const total: Record<string, Buffer> = {};
    for (let i = 0; i < 9; i++) total[`skills/fmt/f${i}.bin`] = Buffer.alloc(250 * 1024);
    const t = (await setup({ ...total, "skills/fmt/SKILL.md": SKILL }).read())!;
    expect(t.refusals.map((r) => r.message)).toContain("the engine folder is over 2 MB");

    const deep = (await setup({ "skills/fmt/SKILL.md": SKILL, "skills/fmt/a/b/c.md": "x" }).read())!;
    expect(deep.refusals).toEqual([{ file: "skills/fmt/a/b", message: "skills/fmt/a/b: folders are nested too deep (over 4 levels)" }]);
  });

  it("the engine folder itself as a symlink is refused", async () => {
    const { dir, o } = setup({ "instructions.md": "x" });
    const other = path.join(root, `alias${++n}`);
    fs.symlinkSync(dir, other);
    const c = (await readEngineConfig(other, o))!;
    expect(c.refusals).toEqual([{ file: ".", message: "the engine folder is a symbolic link" }]);
    expect(c.files.size).toBe(0);
  });

  it("unknown files at the top are refused naming them", async () => {
    const c = (await setup({
      "instructions.md": "x",
      "notes.txt": "n",
      "skills/loose.md": "x",
      "agents/readme.txt": "x",
      "actions/review/codex.toml": "",
    }).read())!;
    expect(c.refusals).toEqual([
      { file: "actions/review/codex.toml", message: "actions/review/codex.toml: is not allowed in an action layer" },
      { file: "agents/readme.txt", message: "agents/readme.txt: only .md agent files are allowed" },
      { file: "notes.txt", message: "notes.txt: is not allowed in the engine folder" },
      { file: "skills/loose.md", message: "skills/loose.md: each skill is a folder with a SKILL.md" },
    ]);
  });

  it("a skill folder without SKILL.md is refused", async () => {
    const c = (await setup({ "skills/fmt/notes.md": "x" }).read())!;
    expect(c.refusals).toEqual([{ file: "skills/fmt", message: "skills/fmt: SKILL.md is missing" }]);
  });

  it("never names an engine home (E7)", () => {
    const src = path.resolve(__dirname, "../../src/main/engine-config");
    // The whole text, comments included: `.claude` as a path part (`config.codex` is a property, not a path).
    const home = /(^|[^\w$)\]])\.(claude|codex|gemini)\b/;
    const files = fs.readdirSync(src).filter((x) => x.endsWith(".ts"));
    expect(files).toContain("read-config.ts");
    for (const f of files) {
      const text = fs.readFileSync(path.join(src, f), "utf8");
      expect(text, f).not.toMatch(home);
      expect(text, f).not.toMatch(/homedir\s*\(|process\.env\.HOME\b|["'`]~\//);
    }
    expect('/** a */ x = "~/.claude"').toMatch(home);
    expect("// ~/.codex").toMatch(home);
    expect("config.codex = x;").not.toMatch(home);
  });
});
