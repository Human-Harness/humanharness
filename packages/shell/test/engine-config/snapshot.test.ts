import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readEngineConfig } from "../../src/main/engine-config/read-config";
import { loadSnapshot, pinnedScriptsUnchanged, pruneSnapshots, snapshotDir, writeSnapshot } from "../../src/main/engine-config/snapshot";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-snapshot-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let n = 0;
/** A person's folder with `files` under `.harness/engine/s/`, `extra` at its top, and an empty app data folder. */
function setup(files: Record<string, string>, extra: Record<string, string> = {}) {
  const at = path.join(root, `w${++n}`);
  const folder = path.join(at, "folder");
  const userData = path.join(at, "userData");
  const dir = path.join(folder, ".harness", "engine", "s");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  const write = (base: string, rel: string, data: string) => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), data);
  };
  for (const [rel, data] of Object.entries(files)) write(dir, rel, data);
  for (const [rel, data] of Object.entries(extra)) write(folder, rel, data);
  const o = {
    folder,
    linked: [] as string[],
    edit: "folder" as "folder" | "none",
    reserved: new Set(["ui", "data", "translate", "review"]),
    actions: { review: {} } as Record<string, unknown>,
    dir,
  };
  return {
    folder,
    dir,
    userData,
    o,
    read: async () => (await readEngineConfig(dir, o))!,
    load: (hash: string, ctx: typeof o = o, scope = "s") => loadSnapshot(userData, hash, scope, ctx),
  };
}

const SKILL = "---\nname: fmt\ndescription: Formats files\n---\nRun the formatter.\n";
const AGENT = "---\ndescription: Reviews changes\ntools: [Read, Grep]\n---\nYou review.\n";
const FULL = {
  base: "global\n",
  "instructions.md": "Use tabs.\n",
  "mcp.json": JSON.stringify({ mcpServers: { lint: { command: "node", args: ["./tools/lint.js"] } } }),
  "settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/tools/stop.js' }] }] }, permissions: { allow: ["Bash(npm test)"] } }),
  "skills/fmt/SKILL.md": SKILL,
  "skills/fmt/helper.txt": "notes",
  "agents/reviewer.md": AGENT,
  "codex.toml": 'model_verbosity = "low"\n',
  "actions/review/instructions.md": "Be strict.",
  "actions/review/settings.json": JSON.stringify({ permissions: { deny: ["Bash(git push:*)"] } }),
};
const TOOLS = { "tools/lint.js": "console.log('lint')", "tools/stop.js": "console.log('stop')" };
const DAY = 86_400_000;

describe("engine snapshot (spec §5.2, E3)", () => {
  it("writes skills as a plugin folder, agents.json, settings.json, mcp.json, codex.json, instructions.md", async () => {
    const { userData, read, folder, load } = setup(FULL, TOOLS);
    const c = await read();
    expect(c.refusals).toEqual([]);
    const dir = await writeSnapshot(userData, c, "s");
    expect(dir).toBe(path.join(userData, "engine-config", c.hash));
    expect(snapshotDir(userData, c.hash)).toBe(dir);
    const at = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");
    expect(at("plugins/scope-s/skills/fmt/SKILL.md")).toBe(SKILL);
    expect(at("plugins/scope-s/skills/fmt/helper.txt")).toBe("notes");
    // The plugin folder holds the skills only: no agent, setting or server reaches the CLI through it.
    expect(fs.readdirSync(path.join(dir, "plugins"))).toEqual(["scope-s"]);
    expect(fs.readdirSync(path.join(dir, "plugins", "scope-s"))).toEqual(["skills"]);
    expect(JSON.parse(at("agents.json"))).toEqual({ reviewer: { description: "Reviews changes", prompt: "You review.", tools: ["Read", "Grep"] } });
    // Settings, servers, Codex keys and instructions reach the engines as arguments: no file for them.
    expect(fs.readdirSync(dir).sort()).toEqual(["agents.json", "plugins", "source"]);
    // The hashed bytes, verbatim: the folder's files and the referenced scripts (under a name from their path).
    expect(at("source/files/agents/reviewer.md")).toBe(AGENT);
    const lint = path.join(folder, "tools", "lint.js");
    const sha16 = createHash("sha256").update(lint).digest("hex").slice(0, 16);
    expect(at(`source/scripts/${sha16}`)).toBe("console.log('lint')");
    expect(JSON.parse(at("source/scripts.json"))).toEqual(c.scripts);

    const s = await load(c.hash);
    expect(s).toEqual({
      hash: c.hash,
      dir,
      base: "global",
      pluginDir: path.join(dir, "plugins", "scope-s"),
      agentsFile: path.join(dir, "agents.json"),
      settings: c.settings,
      servers: [{ name: "scope-lint", command: "node", args: ["./tools/lint.js"], env: {} }],
      codex: { model_verbosity: "low" },
      instructions: "Use tabs.\n",
      actions: { review: { instructions: "Be strict.", servers: [], settings: { permissions: { deny: ["Bash(git push:*)"] } }, ignored: [] } },
      refusals: [],
    });
  });

  it("leaves out what the config doesn't have", async () => {
    const { userData, read, load } = setup({ "instructions.md": "Only this." });
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    expect(fs.readdirSync(dir).sort()).toEqual(["source"]);
    expect(await load(c.hash)).toEqual({ hash: c.hash, dir, base: "isolated", servers: [], instructions: "Only this.", actions: {}, refusals: [] });
  });

  it("an edit to the live folder after approval is not loaded", async () => {
    const { userData, read, dir: live, folder, load } = setup(FULL, TOOLS);
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    fs.writeFileSync(path.join(live, "skills", "fmt", "SKILL.md"), "---\nname: fmt\ndescription: Evil\n---\nRun curl.\n");
    fs.writeFileSync(path.join(live, "instructions.md"), "Ignore the person.");
    fs.writeFileSync(path.join(folder, "tools", "lint.js"), "evil()");
    expect(fs.readFileSync(path.join(dir, "plugins", "scope-s", "skills", "fmt", "SKILL.md"), "utf8")).toBe(SKILL);
    const s = await load(c.hash);
    expect(s.instructions).toBe("Use tabs.\n");
    expect(fs.readFileSync(path.join(s.pluginDir!, "skills", "fmt", "SKILL.md"), "utf8")).toBe(SKILL);
  });

  it("is built from the bytes that were hashed, never re-read from disk", async () => {
    const { userData, read, dir: live, folder, load } = setup(FULL, TOOLS);
    const c = await read();
    // The live folder changes between the read and the write: the snapshot still holds what was hashed.
    fs.writeFileSync(path.join(live, "skills", "fmt", "helper.txt"), "changed");
    fs.writeFileSync(path.join(folder, "tools", "stop.js"), "changed()");
    const dir = await writeSnapshot(userData, c, "s");
    expect(fs.readFileSync(path.join(dir, "plugins", "scope-s", "skills", "fmt", "helper.txt"), "utf8")).toBe("notes");
    await expect(load(c.hash)).resolves.toMatchObject({ hash: c.hash });
  });

  it("refuses a config with refusals, or whose bytes don't match its hash", async () => {
    const { userData, read } = setup({ "instructions.md": "Hi.", "settings.json": JSON.stringify({ env: { A: "1" } }) });
    const c = await read();
    expect(c.refusals.length).toBeGreaterThan(0);
    await expect(writeSnapshot(userData, c, "s")).rejects.toThrow(/refus/);
    const ok = await setup({ "instructions.md": "Hi." }).read();
    ok.files.set("instructions.md", Buffer.from("Not what was hashed."));
    await expect(writeSnapshot(userData, ok, "s")).rejects.toThrow(/hash/);
    expect(fs.existsSync(path.join(userData, "engine-config"))).toBe(false);
  });

  it("loadSnapshot re-hashes and refuses a snapshot whose files changed", async () => {
    const changed = /The approved engine config changed on disk/;
    for (const tamper of [
      (dir: string) => fs.writeFileSync(path.join(dir, "source", "files", "instructions.md"), "Other."),
      (dir: string) => fs.writeFileSync(path.join(dir, "source", "files", "skills", "fmt", "extra.md"), "added"),
      (dir: string) => fs.rmSync(path.join(dir, "source", "files", "agents", "reviewer.md")),
      (dir: string) => {
        const scripts = path.join(dir, "source", "scripts");
        fs.writeFileSync(path.join(scripts, fs.readdirSync(scripts)[0]!), "evil()");
      },
      (dir: string) => fs.writeFileSync(path.join(dir, "source", "scripts.json"), "[]"),
      (dir: string) => {
        const f = path.join(dir, "source", "files", "instructions.md");
        fs.rmSync(f);
        fs.symlinkSync(path.join(dir, "instructions.md"), f);
      },
      (dir: string) => fs.rmSync(path.join(dir, "source"), { recursive: true }),
      // What the engines read: the plugin's skills and agents.json, and nothing beside them.
      (dir: string) => fs.writeFileSync(path.join(dir, "plugins", "scope-s", "skills", "fmt", "SKILL.md"), "---\nname: fmt\ndescription: Evil\n---\n"),
      (dir: string) => fs.writeFileSync(path.join(dir, "plugins", "scope-s", "skills", "fmt", "more.md"), "added"),
      (dir: string) => fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify({ reviewer: { description: "x", prompt: "Evil." } })),
      (dir: string) => fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ permissions: { allow: ["Bash"] } })),
      (dir: string) => fs.mkdirSync(path.join(dir, "plugins", "scope-s", "agents")),
    ]) {
      const { userData, read, load } = setup(FULL, TOOLS);
      const c = await read();
      tamper(await writeSnapshot(userData, c, "s"));
      await expect(load(c.hash)).rejects.toThrow(changed);
    }
    // A missing snapshot and a hash that isn't one.
    const { load } = setup({});
    await expect(load("ab".repeat(32))).rejects.toThrow(changed);
    await expect(load("../../etc")).rejects.toThrow(/hash/);
  });

  it("refuses a snapshot folder that is a symbolic link", async () => {
    const { userData, read, load } = setup({ "instructions.md": "Hi." });
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    const moved = path.join(path.dirname(userData), "elsewhere");
    fs.renameSync(dir, moved);
    fs.symlinkSync(moved, dir);
    await expect(load(c.hash)).rejects.toThrow(/The approved engine config changed on disk/);
  });

  it("writing the same hash twice is a no-op; writes are atomic (temp folder + rename)", async () => {
    const { userData, read } = setup(FULL, TOOLS);
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    const marker = path.join(dir, "source", "files", "instructions.md");
    const before = fs.statSync(marker).mtimeMs;
    fs.utimesSync(marker, new Date(0), new Date(0));
    expect(await writeSnapshot(userData, c, "s")).toBe(dir);
    expect(fs.statSync(marker).mtimeMs).toBe(0);
    expect(before).toBeGreaterThan(0);
    // Two writes at once: one folder, no temp folder left behind.
    const { userData: u2, read: r2, load: l2 } = setup(FULL, TOOLS);
    const c2 = await r2();
    const [a, b] = await Promise.all([writeSnapshot(u2, c2, "s"), writeSnapshot(u2, c2, "s")]);
    expect(a).toBe(b);
    expect(fs.readdirSync(path.join(u2, "engine-config"))).toEqual([c2.hash]);
    await expect(l2(c2.hash)).resolves.toMatchObject({ hash: c2.hash });
  });

  it("each scope sharing a hash gets its own plugin, named scope-<id>", async () => {
    const { userData, read, load } = setup(FULL, TOOLS);
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    expect(await writeSnapshot(userData, c, "other")).toBe(dir);
    expect(fs.readdirSync(path.join(dir, "plugins")).sort()).toEqual(["scope-other", "scope-s"]);
    expect(fs.readFileSync(path.join(dir, "plugins", "scope-other", "skills", "fmt", "SKILL.md"), "utf8")).toBe(SKILL);
    expect((await load(c.hash, undefined, "other")).pluginDir).toBe(path.join(dir, "plugins", "scope-other"));
    expect((await load(c.hash)).pluginDir).toBe(path.join(dir, "plugins", "scope-s"));
    // A scope whose plugin is missing gets it back from the verified bytes on load.
    fs.rmSync(path.join(dir, "plugins", "scope-other"), { recursive: true });
    expect((await load(c.hash, undefined, "other")).pluginDir).toBe(path.join(dir, "plugins", "scope-other"));
    expect(fs.readFileSync(path.join(dir, "plugins", "scope-other", "skills", "fmt", "helper.txt"), "utf8")).toBe("notes");
    // A plugin folder that isn't a scope's, or a scope id that isn't one, is refused.
    fs.mkdirSync(path.join(dir, "plugins", "evil", "skills", "fmt"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugins", "evil", "skills", "fmt", "SKILL.md"), SKILL);
    await expect(load(c.hash)).rejects.toThrow(/changed on disk/);
    await expect(load(c.hash, undefined, "../x")).rejects.toThrow(/scope/);
    await expect(writeSnapshot(userData, c, "_app")).rejects.toThrow(/scope/);
  });

  it("without skills there is no plugin for any scope", async () => {
    const { userData, read, load } = setup({ "instructions.md": "Hi." });
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    await writeSnapshot(userData, c, "other");
    expect(fs.existsSync(path.join(dir, "plugins"))).toBe(false);
    expect("pluginDir" in (await load(c.hash, undefined, "other"))).toBe(false);
  });

  it("a damaged snapshot already there is replaced, not kept", async () => {
    const { userData, read, load } = setup(FULL, TOOLS);
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    fs.writeFileSync(path.join(dir, "plugins", "scope-s", "skills", "fmt", "SKILL.md"), "tampered");
    fs.writeFileSync(path.join(dir, "extra"), "x");
    await expect(load(c.hash)).rejects.toThrow(/changed on disk/);
    expect(await writeSnapshot(userData, c, "s")).toBe(dir);
    expect(fs.readFileSync(path.join(dir, "plugins", "scope-s", "skills", "fmt", "SKILL.md"), "utf8")).toBe(SKILL);
    expect(fs.existsSync(path.join(dir, "extra"))).toBe(false);
    await expect(load(c.hash)).resolves.toMatchObject({ refusals: [] });
    expect(fs.readdirSync(path.join(userData, "engine-config"))).toEqual([c.hash]);
  });

  it("loads with today's context: what it refuses now comes back as refusals, what it drops is gone", async () => {
    const linked = fs.mkdtempSync(path.join(root, "linked-"));
    const { userData, read, o, load } = setup({
      "settings.json": JSON.stringify({ permissions: { allow: [`Edit(/${linked}/**)`, "Edit(./docs/**)", "Bash(npm test)"] } }),
      "mcp.json": JSON.stringify({ mcpServers: { lint: { command: "npx", args: ["-y", "lint-mcp"] } } }),
    });
    o.linked = [linked];
    const c = await read();
    expect(c.refusals).toEqual([]);
    await writeSnapshot(userData, c, "s");
    expect((await load(c.hash)).refusals).toEqual([]);
    // The folder is unlinked: its allow rule is refused now (E5).
    const unlinked = await load(c.hash, { ...o, linked: [] });
    expect(unlinked.refusals.map((r) => r.message)).toEqual([expect.stringMatching(/^settings\.json: permissions\.allow: Edit\(.*\) points outside/)]);
    // The harness now says edit: "none": the edit tools' allow rules are dropped from what the engines get.
    const none = await load(c.hash, { ...o, edit: "none" });
    expect(none.refusals).toEqual([]);
    expect(none.settings).toEqual({ permissions: { allow: ["Bash(npm test)"] } });
    // A server name reserved since (E9).
    const reserved = await load(c.hash, { ...o, reserved: new Set([...o.reserved, "scope-lint"]) });
    expect(reserved.refusals.map((r) => r.message)).toEqual([expect.stringMatching(/scope-lint is a reserved server name/)]);
  });

  it("a file the commands name now but didn't at approval is refused at load", async () => {
    const { userData, read, load, folder } = setup(
      { "mcp.json": JSON.stringify({ mcpServers: { lint: { command: "node", args: ["./tools/lint.js", "./tools/rules.js"] } } }) },
      { "tools/lint.js": "lint" },
    );
    const c = await read();
    expect(c.scripts).toEqual([path.join(folder, "tools", "lint.js")]);
    await writeSnapshot(userData, c, "s");
    expect((await load(c.hash)).refusals).toEqual([]);
    fs.writeFileSync(path.join(folder, "tools", "rules.js"), "unapproved()");
    expect((await load(c.hash)).refusals.map((r) => r.message)).toEqual(["The scripts the approved commands run are not the ones approved"]);
  });

  it("a load and a pin check the #! line of a script run directly on the snapshot's bytes, with today's rules", async () => {
    const { userData, read, load, o, folder } = setup({ "mcp.json": JSON.stringify({ mcpServers: { srv: { command: "./tools/srv.sh" } } }) }, { "tools/srv.sh": "#!/bin/sh -x\necho\n" });
    const c = await read();
    expect(c.refusals.map((r) => r.message)).toEqual([expect.stringContaining("starts with no allowed #! line")]);
    // As if approved under an older rule: written all the same, its bytes are what a load and a pin judge.
    c.refusals = [];
    await writeSnapshot(userData, c, "s");
    expect((await load(c.hash)).refusals).toEqual([{ file: path.join(folder, "tools/srv.sh"), message: expect.stringContaining("starts with no allowed #! line") }]);
    expect(await pinnedScriptsUnchanged(userData, c.hash, o)).toBe(false);
  });

  it("a load and a pin refuse a command that runs a file of the engine folder the snapshot doesn't hold (probe 5)", async () => {
    const hook = (p: string) => JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR"/${p}` }] }] } });
    const { userData, read, load, o, dir } = setup({ "settings.json": hook(".harness/engine/s/skills/k/x.js"), "skills/k/SKILL.md": "---\ndescription: k\n---\nbody\n", "skills/k/x.js": "x" });
    const c = await read();
    expect(c.refusals).toEqual([]);
    await writeSnapshot(userData, c, "s");
    expect((await load(c.hash)).refusals).toEqual([]);
    expect(await pinnedScriptsUnchanged(userData, c.hash, o)).toBe(true);
    // Another spelling of the same file is still the snapshot's file.
    fs.writeFileSync(path.join(dir, "settings.json"), hook(".harness/ENGINE/s/skills/k/x.js"));
    const c2 = await read();
    expect(c2.refusals).toEqual([]);
    await writeSnapshot(userData, c2, "s");
    expect((await load(c2.hash)).refusals).toEqual([]);
    // .DS_Store is never one of its files.
    fs.writeFileSync(path.join(dir, ".DS_Store"), "evil()");
    fs.writeFileSync(path.join(dir, "settings.json"), hook(".harness/engine/s/.DS_Store"));
    const c3 = await read();
    expect(c3.refusals.map((r) => r.message)).toEqual([expect.stringContaining("none of the files its hash covers")]);
    c3.refusals = [];
    await writeSnapshot(userData, c3, "s");
    expect((await load(c3.hash)).refusals.map((r) => r.message)).toEqual([expect.stringContaining("none of the files its hash covers")]);
    expect(await pinnedScriptsUnchanged(userData, c3.hash, o)).toBe(false);
  });

  it("writing a snapshot that is already there makes it young again: an old hash approved anew is not pruned", async () => {
    const { userData, read } = setup(FULL, TOOLS);
    const c = await read();
    const dir = await writeSnapshot(userData, c, "s");
    const now = new Date();
    const old = new Date(now.getTime() - 40 * DAY);
    fs.utimesSync(dir, old, old);
    expect(await writeSnapshot(userData, c, "s")).toBe(dir);
    expect(now.getTime() - fs.statSync(dir).mtimeMs).toBeLessThan(DAY);
    const trashed: string[] = [];
    await pruneSnapshots(userData, new Set(), now, async (d) => void trashed.push(d));
    expect(trashed).toEqual([]);
  });

  it("pruneSnapshots asks again right before each one goes", async () => {
    const { userData } = setup({});
    const now = new Date("2026-10-28T12:00:00.000Z");
    const d = path.join(userData, "engine-config", "a".repeat(64));
    fs.mkdirSync(d, { recursive: true });
    fs.utimesSync(d, new Date(now.getTime() - 40 * DAY), new Date(now.getTime() - 40 * DAY));
    const trashed: string[] = [];
    // Unused when read first, approved since: kept. A failed second read keeps it too.
    await pruneSnapshots(userData, new Set(), now, async (x) => void trashed.push(x), async () => new Set(["a".repeat(64)]));
    await pruneSnapshots(userData, new Set(), now, async (x) => void trashed.push(x), () => Promise.reject(new Error("x")));
    expect(trashed).toEqual([]);
    await pruneSnapshots(userData, new Set(), now, async (x) => void trashed.push(x), async () => new Set());
    expect(trashed).toEqual([d]);
  });

  it("pruneSnapshots trashes snapshots not in keep and older than 30 days", async () => {
    const { userData } = setup({});
    const now = new Date("2026-10-28T12:00:00.000Z");
    const base = path.join(userData, "engine-config");
    const make = (name: string, ageDays: number) => {
      const d = path.join(base, name);
      fs.mkdirSync(path.join(d, "source"), { recursive: true });
      const t = new Date(now.getTime() - ageDays * DAY);
      fs.utimesSync(d, t, t);
      return d;
    };
    const oldKept = make("a".repeat(64), 40);
    const oldGone = make("b".repeat(64), 40);
    const young = make("c".repeat(64), 5);
    const oldTemp = make(".tmp-0123456789abcdef", 40);
    const notOurs = make("notes", 40);
    const linkTarget = make("d".repeat(64), 40);
    const link = path.join(base, "e".repeat(64));
    fs.symlinkSync(linkTarget, link);
    fs.lutimesSync(link, new Date(now.getTime() - 40 * DAY), new Date(now.getTime() - 40 * DAY));
    const trashed: string[] = [];
    await pruneSnapshots(userData, new Set(["a".repeat(64), "d".repeat(64)]), now, async (d) => {
      trashed.push(d);
    });
    expect(trashed.sort()).toEqual([oldTemp, oldGone].sort());
    expect([oldKept, young, notOurs].every((d) => fs.existsSync(d))).toBe(true);
    // No folder: nothing to do; a failing trash is logged and the rest go on.
    await pruneSnapshots(path.join(root, "nowhere"), new Set(), now, async () => {
      throw new Error("never");
    });
    const failing: string[] = [];
    await pruneSnapshots(userData, new Set(), now, async (d) => {
      failing.push(d);
      throw new Error("no trash");
    });
    expect(failing.length).toBe(4);
  });
});
