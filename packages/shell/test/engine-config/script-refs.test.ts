import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandWords, directScripts, scanScripts, scriptRefs, shebangProblem, type ScriptCommand } from "../../src/main/engine-config/script-refs";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-script-refs-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function tree(name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const FORM = "a hook or server must run a plain script file: <interpreter> <script> [args]";
const P = '"$CLAUDE_PROJECT_DIR"';

/** Whether `command` is refused: by the grammar (a throw) or by what it names (an issue). */
const refused = (command: ScriptCommand, o: { folder: string; linked: string[] }) =>
  scanScripts([command], o).then(
    (s) => s.issues.length > 0,
    (e: Error) => e.message.includes(FORM),
  );

describe("the command grammar (E2: <interpreter> <script> [args], <script> [args], npx/uvx remote packages)", () => {
  const w = tree("g", { "tools/x.js": "x", "tools/run.sh": "#!/bin/sh\nr", "my tools/y.js": "y", "conf/a.json": "{}", "conf/b.json": "{}" });
  const repo = tree("g-repo", { "bin/y.sh": "y" });
  const o = { folder: w, linked: [repo] };
  const scan = (c: ScriptCommand) => scanScripts([c], o);

  it("hashes the script and every argument that names a regular file in a root", async () => {
    expect(await scan(`node ${P}/tools/x.js --config=${w}/conf/a.json`)).toEqual({ files: [path.join(w, "conf/a.json"), path.join(w, "tools/x.js")], issues: [] });
    expect((await scan(`bash ${repo}/bin/y.sh`)).files).toEqual([path.join(repo, "bin/y.sh")]);
    expect((await scan(`${P}/tools/run.sh fast`)).files).toEqual([path.join(w, "tools/run.sh")]);
    expect((await scan(`node "${w}/my tools/y.js"`)).files).toEqual([path.join(w, "my tools/y.js")]);
    expect((await scan(["python3", "./tools/x.js", "-c./conf/a.json"])).files).toEqual([path.join(w, "conf/a.json"), path.join(w, "tools/x.js")]);
    expect((await scan(`/usr/bin/python3 ${P}/tools/x.js`)).files).toEqual([path.join(w, "tools/x.js")]);
    expect((await scan(`SH ${P}/tools/run.sh`)).files).toEqual([path.join(w, "tools/run.sh")]);
    // Parts between `=`, `,` and `:`, and after a leading `@`, are places too.
    expect((await scan(["node", "./tools/x.js", "--plugins=./conf/a.json,./conf/b.json"])).files).toEqual([path.join(w, "conf/a.json"), path.join(w, "conf/b.json"), path.join(w, "tools/x.js")]);
    expect((await scan(["node", "./tools/x.js", "--x:./conf/a.json", "@./conf/b.json"])).files).toEqual([path.join(w, "conf/a.json"), path.join(w, "conf/b.json"), path.join(w, "tools/x.js")]);
  });

  it('takes only "$CLAUDE_PROJECT_DIR"/… (quoted, then a slash) as the folder', async () => {
    for (const c of [`node ${P}/tools/x.js`, 'node "${CLAUDE_PROJECT_DIR}"/tools/x.js']) {
      expect(commandWords(c, w), c).toEqual(["node", path.join(w, "tools/x.js")]);
    }
    expect(commandWords(`node ${P}/tools/x.js`, "/my folder")).toEqual(["node", "/my folder/tools/x.js"]);
    // Unquoted, sh splits and globs it (a folder named "My Work").
    for (const c of ["node $CLAUDE_PROJECT_DIR/tools/x.js", "node ${CLAUDE_PROJECT_DIR}/tools/x.js", 'node "$CLAUDE_PROJECT_DIR/tools/x.js"', `node ${P}`, "node $CLAUDE_PROJECT_DIRX/x.js", "node '$CLAUDE_PROJECT_DIR'/x.js", `node ./a${P}/x.js`, "node $HOME/x.js"]) {
      expect(() => commandWords(c, w), c).toThrow(FORM);
    }
  });

  it("a hook names its script and every path-like argument absolutely: it runs in the folder the agent cd'd to", async () => {
    for (const c of ["node ./tools/x.js", "node tools/x.js", "node ok.js", `node ${P}/tools/x.js ./conf/a.json`, `node ${P}/tools/x.js --c=conf/a.json`, `node ${P}/tools/x.js ..`, "./tools/run.sh"]) {
      expect(() => commandWords(c, w), c).toThrow(FORM);
    }
    expect(() => commandWords("node ./tools/x.js", w)).toThrow(`write ${P}/tools/x.js`);
    // Plain words stay words; a server's relative paths are from the folder (its working folder).
    expect(commandWords(`node ${P}/tools/x.js fast -v 1.5`, w)).toEqual(["node", path.join(w, "tools/x.js"), "fast", "-v", "1.5"]);
    expect(commandWords(["node", "tools/x.js", "./conf/a.json"], w)).toEqual(["node", "tools/x.js", "./conf/a.json"]);
  });

  it("a Codex hook takes absolute paths only: Codex sets no CLAUDE_PROJECT_DIR", async () => {
    expect((await scan({ codex: `node ${w}/tools/x.js` })).files).toEqual([path.join(w, "tools/x.js")]);
    for (const c of [`node ${P}/tools/x.js`, "node ./tools/x.js", `node ${w}/tools/x.js ./conf/a.json`]) {
      expect(() => commandWords({ codex: c }, w), c).toThrow(FORM);
    }
    expect(() => commandWords({ codex: `node ${P}/x.js` }, w)).toThrow("Codex doesn't set");
  });

  it("a script that is no regular file in a root is refused: missing, outside, a folder, a link", async () => {
    const outside = tree("g-out", { "z.js": "z" });
    fs.symlinkSync(path.join(w, "tools/x.js"), path.join(w, "link.js"));
    const why = async (c: ScriptCommand) => (await scan(c)).issues.map((i) => [path.relative(root, i.path), i.why]);
    expect(await why(`node ${P}/missing.js`)).toEqual([["g/missing.js", "is not a script file in the folder or a linked folder"]]);
    expect(await why(`node ${outside}/z.js`)).toEqual([["g-out/z.js", "is not a script file in the folder or a linked folder"]]);
    expect(await why(["node", "../g-out/z.js"])).toEqual([["g-out/z.js", "is not a script file in the folder or a linked folder"]]);
    expect(await why(`node ${P}/tools`)).toEqual([["g/tools", "is a folder"]]);
    expect(await why(["node", "."])).toEqual([["g", "is a folder"]]);
    expect(await why(`node ${P}/link.js`)).toEqual([["g/link.js", "is a symbolic link"]]);
  });

  it("without an interpreter the script is a path: a bare word is a program on PATH or a builtin, whatever the folder holds", async () => {
    const b = tree("g-bare", { npm: "x", make: "x", git: "x", exec: "x" });
    for (const c of ["npm test", "make", "git status", "exec npm test", ["npm", "test"], ["make"], ["git", "status"], ["server"]] as ScriptCommand[]) {
      expect(() => commandWords(c, b), JSON.stringify(c)).toThrow("not a path to a script");
    }
  });

  it("a script run directly starts with #!/usr/bin/env <interpreter> or #!<system interpreter>, no options", async () => {
    for (const ok of ["#!/usr/bin/env node\n", "#!/usr/bin/env python3\r\nx", "#!/bin/sh\n", "#!/bin/bash", "#! /usr/local/bin/python3\n", "#!/opt/homebrew/bin/node\n"]) {
      expect(shebangProblem(ok), ok).toBeNull();
    }
    for (const bad of ["", "echo hi\n", "#!/usr/bin/env -S node --x\n", "#!/usr/bin/env node --require ./x\n", "#!/usr/bin/env deno\n", "#!/bin/sh -x\n", "#!./node\n", "#!/tmp/node\n", "#!/usr/bin/perl\n", "#!/usr/bin/env\n"]) {
      expect(shebangProblem(bad), bad).not.toBeNull();
    }
    const s = tree("g-shebang", { "plain.sh": "echo x\n", "opt.sh": "#!/bin/bash -p\n", "ok.sh": "#!/usr/bin/env bash\n" });
    const so = { folder: s, linked: [] };
    // The scan never reads the line: it is judged on the bytes hashed (read-config). It lists the scripts run directly.
    expect((await scanScripts([["./plain.sh"]], so)).files).toEqual([path.join(s, "plain.sh")]);
    expect(directScripts([["./ok.sh"], ["sh", "./plain.sh"], 'bash "$CLAUDE_PROJECT_DIR"/opt.sh', `${P}/opt.sh x`, ["npx", "y"], "git status"], s)).toEqual([
      { path: path.join(s, "ok.sh"), command: "./ok.sh" },
      { path: path.join(s, "opt.sh"), command: `${P}/opt.sh x` },
    ]);
  });

  it("an interpreter named by a path inside a root is refused", async () => {
    const r = tree("g-interp", { "a.js": "a" });
    expect(await refused(["/usr/bin/node", "./a.js"], { folder: r, linked: ["/usr/bin"] })).toBe(true);
    expect(await refused(["/usr/bin/node", "./a.js"], { folder: r, linked: [] })).toBe(false);
  });

  it("an argument naming a root, a folder, a link or a FIFO in a root is refused; outside or missing, it is only a word", async () => {
    execFileSync("mkfifo", [path.join(w, "pipe")]);
    const why = async (c: ScriptCommand) => (await scan(c)).issues.map((i) => [path.relative(root, i.path), i.why]);
    expect(await why(["node", "./tools/x.js", "."])).toEqual([["g", "is a folder"]]);
    expect(await why(["node", "./tools/x.js", "tools"])).toEqual([["g/tools", "is a folder"]]);
    expect(await why(["node", "./tools/x.js", "pipe"])).toEqual([["g/pipe", "is not a regular file"]]);
    expect(await why(["node", "./tools/x.js", "--out=./link.js"])).toEqual([["g/link.js", "is a symbolic link"]]);
    expect(await why(["node", "./tools/x.js", "--list=a,./tools"])).toEqual([["g/tools", "is a folder"]]);
    expect(await why(["node", "./tools/x.js", "nothing-here", "/etc/hosts", "../up.js"])).toEqual([]);
  });

  it("a server's env values follow the arguments' rule, and a root is refused there too", async () => {
    const e = (env: Record<string, string>) => scan({ argv: ["node", "./tools/x.js"], env });
    expect((await e({ RULES: "./conf/a.json" })).files).toEqual([path.join(w, "conf/a.json"), path.join(w, "tools/x.js")]);
    expect((await e({ RULES: "a:./conf/b.json" })).files).toContain(path.join(w, "conf/b.json"));
    for (const v of [".", w, "./tools", "./link.js"]) expect((await e({ AT: v })).issues.length, v).toBe(1);
    expect((await scan({ argv: ["npx", "-y", "srv", "."], env: { AT: "." } })).issues.map((i) => i.why)).toEqual(["is a folder"]);
    expect((await e({ LEVEL: "debug" })).issues).toEqual([]);
  });

  it("remote packages on a server: npx [-y] <name>[@version], uvx <name>[==version]; a root may be their argument", async () => {
    expect(await scan(["npx", "-y", "@modelcontextprotocol/server-filesystem", "."])).toEqual({ files: [], issues: [] });
    expect(await scan(["npx", "cowsay@1.2.0", "hi"])).toEqual({ files: [], issues: [] });
    expect(await scan(["uvx", "mcp-server-fetch==1.0"])).toEqual({ files: [], issues: [] });
    // But not a folder below it, nor in a hook.
    expect((await scan(["npx", "-y", "srv", "./tools"])).issues.map((i) => i.why)).toEqual(["is a folder"]);
    expect(() => commandWords("npx -y srv", w)).toThrow("not a path to a script");
    for (const c of [["npx", "./tools"], ["npx", "file:../x"], ["npx", "-p", "x", "y"], ["npx", "-c", "node ."], ["npx", "--yes"], ["uvx", "--from", ".", "x"], ["uvx", "./pkg"], ["uvx", "foo[extra]"]]) {
      expect(() => commandWords(c, w), c.join(" ")).toThrow(FORM);
    }
  });

  it("npx is refused when .npmrc or node_modules is in the folder, a linked folder, or any folder above them", async () => {
    const base = tree("g-npm", {});
    const at = (rel: string, name: string, dir = false) => {
      const top = fs.mkdtempSync(path.join(base, "t-"));
      const folder = path.join(top, "a", "work");
      fs.mkdirSync(folder, { recursive: true });
      const p = path.join(top, rel, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (dir) fs.mkdirSync(p);
      else fs.writeFileSync(p, "script-shell=./evil.sh\n");
      return { folder, p };
    };
    for (const [rel, name, dir] of [["a/work", ".npmrc", false], ["a", ".npmrc", false], ["", "node_modules", true], ["a/work", "node_modules", true]] as const) {
      const { folder, p } = at(rel, name, dir);
      expect((await scanScripts([["npx", "-y", "srv"]], { folder, linked: [] })).issues.map((i) => i.path)).toEqual([p]);
    }
    const linked = at("b", ".npmrc");
    const clean = tree("g-npm-clean", {});
    expect((await scanScripts([["npx", "-y", "srv"]], { folder: clean, linked: [path.dirname(linked.p)] })).issues.map((i) => i.path)).toEqual([linked.p]);
    expect((await scanScripts([["npx", "-y", "srv"]], { folder: clean, linked: [] })).issues).toEqual([]);
  });

  it("uvx is refused when the folders hold a Python project, uv config, a pinned Python, a lock, or the module", async () => {
    for (const f of ["uv.toml", "pyproject.toml", ".python-version", "uv.lock", "localmod.py", "localmod/__init__.py"]) {
      const d = tree(`g-uv-${f.replace(/[/.]/g, "_")}`, { [f]: "x" });
      const s = await scanScripts([["uvx", "localmod"]], { folder: path.join(d), linked: [] });
      expect(s.issues.length, f).toBe(1);
    }
    const parent = tree("g-uv-parent", { "pyproject.toml": "x", "work/keep": "" });
    expect((await scanScripts([["uvx", "x"]], { folder: path.join(parent, "work"), linked: [] })).issues.map((i) => i.path)).toEqual([path.join(parent, "pyproject.toml")]);
  });

  it("scriptRefs lists the hashed files and the refused paths together (a pin or a load compares them)", async () => {
    expect(await scriptRefs([`node ${P}/tools/x.js`, `node ${P}/tools`], o)).toEqual([path.join(w, "tools"), path.join(w, "tools/x.js")]);
  });
});

describe("everything else is refused (probe 3, E2)", () => {
  const w = tree("p3", { "evil.js": "evil", "ok.js": "#!/usr/bin/env node\nok", "index.js": "i", "tools/a.js": "a", "pkg/__main__.py": "m", "node_modules/evilpkg/index.js": "e" });
  const o = { folder: w, linked: [] as string[] };

  it.each([
    "true #'\nnode ./evil.js\n#'",
    "cat <<E\n'\nE\nnode ./evil.js\ncat <<E\n'\nE",
    'node "./ev\\\nil.js"',
    "node ./ev\\\nil.js",
    "'n''ode' .",
    "{ node .; }",
    "! node .",
    "if true; then node .; fi",
    "coproc node .",
    "f(){ node .; }; f",
    "while false; do node .; done",
    "! node -r evilpkg ./ok.js",
    "node -r evilpkg ./ok.js",
    "builtin eval 'node .'",
    "trap 'node .' EXIT",
    "timeout 10 node .",
    "nice node .",
    "Node .",
    "NODE .",
    "Bash -c 'node .'",
    "NPM test",
    "Make",
    "find tools -type f -exec node {} \\;",
    "echo | sed '1e node .'",
    "git -c core.hooksPath=tools commit -m x",
    "git status",
    "tar xf a.tar --to-command='node .'",
    "npm --prefix . test",
    "npm --prefix sub run x",
    "go -C . test",
    "npm install",
    "npm it",
    "npm ci",
    "npm rebuild",
    "npm version patch",
    "pnpm build",
    "yarn build",
    "pnpm install",
    "npx -c 'node .'",
    "npm exec -c 'node .'",
    "python3.12 pkg",
    "python3.12 .",
    "tsx .",
    "python --check-hash-based-pycs always pkg",
    "node --conditions dev .",
    "node -C dev .",
    "node --title x .",
    "node --test",
    "node --run build",
    "deno test",
    "python -m pytest",
    "ZDOTDIR=. zsh -c true",
    "HOME=. zsh -c true",
    "PYTHONUSERBASE=. python3 ./ok.js",
    "bash <<E\nnode ./ok.js\nE",
    "node < ./evil.js",
    "cat >(node .)",
    'node -e "require(\'./evil.js\')"',
    "sh -c 'node ./ok.js'",
    "bash -c true",
    "node ~/x.js",
    "node ./ok.js; node ./evil.js",
    "node ./ok.js && node ./evil.js",
    "node ./ok.js | sh",
    "node ./ok.js `x`",
    "node ./ok.js $(x)",
    "node ./o*.js",
    "",
    "   ",
    ["server"],
    ["node", "--conditions", "dev", "."],
    ["uv", "--project", "pkg", "run", "srv"],
    ["npm", "--prefix", ".", "start"],
    ["node", "--test"],
    ["Node", "."],
    ["npx", "evilpkg"],
    ["uvx", "pkg"],
    ["python3", "-m", "pkg"],
  ])("refuses %j", async (command) => {
    expect(await refused(command, o)).toBe(true);
  });

  it.each([
    [`node ${P}/ok.js`, ["ok.js"]],
    [["./ok.js"], ["ok.js"]],
    [["python3", "./ok.js", "--cfg=./evil.js"], ["evil.js", "ok.js"]],
  ] as const)("passes %j, hashing what it names", async (command, hashed) => {
    expect(await scanScripts([command as ScriptCommand], o)).toEqual({ files: hashed.map((f) => path.join(w, f)), issues: [] });
  });

  it("an accented folder name in either Unicode form is the same folder (the script is hashed, never outside)", async () => {
    const a = tree("José".normalize("NFC"), { "evil.js": "e" });
    for (const form of ["NFC", "NFD"] as const) {
      const c = `node ${a.normalize(form)}/evil.js`;
      const s = await scanScripts([c], { folder: a, linked: [] });
      expect(s.issues, form).toEqual([]);
      expect(s.files.map((f) => path.basename(f)), form).toEqual(["evil.js"]);
    }
  });

  it("a huge command is refused for its size, at once", async () => {
    const t = Date.now();
    for (const c of ["echo " + "a ".repeat(128_000), "node ./ok.js " + "./ok.js ".repeat(32_000), "echo " + "a=".repeat(120_000), ";".repeat(256_000), "'a'".repeat(80_000), "node " + "a ".repeat(70)]) {
      await expect(scanScripts([c], o)).rejects.toThrow(FORM);
    }
    await expect(scanScripts([["node", ...Array.from({ length: 70 }, () => "a")]], o)).rejects.toThrow("over 64 words");
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("probe 4 (E2)", () => {
  const w = tree("p4", { "ok.js": "#!/usr/bin/env node\nok", "ok.sh": "#!/bin/sh\nok", "ok.py": "ok", "tools/a.js": "a", npm: "x", exec: "x", eval: "x", make: "x", time: "x", command: "x", env: "x", git: "x" });
  const sp = tree("p4 My Work", { "ok.js": "ok" });
  const o = { folder: w, linked: [] as string[] };

  it.each([
    "npm test",
    "exec npm test",
    "eval npm test",
    "make",
    "time npm test",
    "command npm test",
    "env npm test",
    "git status",
    ["npm", "test"],
    ["make"],
    ["git", "status"],
    "node \u0000folder\u0000/ok.js",
    "sh \u0000folder\u0000/ok.sh",
    "\u0000folder\u0000/ok.sh",
    "node ok.js",
    "bash ok.sh",
    "python3 ok.py",
    "node ./ok.js",
    "node ./ok.js if then",
    "node ./ok.js",
    "node　./ok.js",
    ["uvx", "foo[extra]"],
    `node ${P}/ok.js ./tools/a.js`,
    `node ${P}/ok.js --plugins=./tools/a.js,./ok.js`,
    `node ${P}/ok.js --x:./tools/a.js`,
    `node ${P}/ok.js @./tools/a.js`,
  ])("refuses %j", async (command) => {
    expect(await refused(command, o)).toBe(true);
  });

  it('refuses an unquoted $CLAUDE_PROJECT_DIR (a folder with a space), passes the quoted one', async () => {
    expect(await refused("node $CLAUDE_PROJECT_DIR/ok.js", { folder: sp, linked: [] })).toBe(true);
    expect((await scanScripts([`node ${P}/ok.js`], { folder: sp, linked: [] })).files).toEqual([path.join(sp, "ok.js")]);
  });

  it("an npx server is refused with an .npmrc in the folder", async () => {
    const n = tree("p4-npmrc", { ".npmrc": "script-shell=./evil.sh\n" });
    expect(await refused(["npx", "-y", "foo"], { folder: n, linked: [] })).toBe(true);
    expect(await refused(["npx", "-y", "foo@latest"], { folder: n, linked: [] })).toBe(true);
  });

  it("a uvx server is refused with a pyproject.toml in the folder", async () => {
    const n = tree("p4-py", { "pyproject.toml": "[tool.uv]\n" });
    expect(await refused(["uvx", "foo"], { folder: n, linked: [] })).toBe(true);
  });
});
