import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandWords, scanScripts, scriptRefs } from "../../src/main/engine-config/script-refs";

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

describe("the command grammar (E2: <interpreter> <script> [args], <script> [args], npx/uvx remote packages)", () => {
  const w = tree("g", { "tools/x.js": "x", "tools/run.sh": "r", "my tools/y.js": "y", "conf/a.json": "{}" });
  const repo = tree("g-repo", { "bin/y.sh": "y" });
  const o = { folder: w, linked: [repo] };
  const scan = (c: string | string[]) => scanScripts([c], o);

  it("hashes the script and every argument that names a regular file in a root", async () => {
    expect(await scan("node ./tools/x.js --config=./conf/a.json")).toEqual({ files: [path.join(w, "conf/a.json"), path.join(w, "tools/x.js")], issues: [] });
    expect((await scan(`bash ${repo}/bin/y.sh`)).files).toEqual([path.join(repo, "bin/y.sh")]);
    expect((await scan("./tools/run.sh fast")).files).toEqual([path.join(w, "tools/run.sh")]);
    expect((await scan('node "./my tools/y.js"')).files).toEqual([path.join(w, "my tools/y.js")]);
    expect((await scan(["python3", "./tools/x.js", "-c./conf/a.json"])).files).toEqual([path.join(w, "conf/a.json"), path.join(w, "tools/x.js")]);
    expect((await scan("/usr/bin/python3 ./tools/x.js")).files).toEqual([path.join(w, "tools/x.js")]);
    expect((await scan("SH tools/run.sh")).files).toEqual([path.join(w, "tools/run.sh")]);
  });

  it("takes $CLAUDE_PROJECT_DIR as the folder at the start of a word", async () => {
    for (const c of ['node "$CLAUDE_PROJECT_DIR"/tools/x.js', "node $CLAUDE_PROJECT_DIR/tools/x.js", "node ${CLAUDE_PROJECT_DIR}/tools/x.js", 'node "$CLAUDE_PROJECT_DIR/tools/x.js"']) {
      expect(commandWords(c, w), c).toEqual(["node", path.join(w, "tools/x.js")]);
    }
    expect(commandWords("node $CLAUDE_PROJECT_DIR/tools/x.js", "/my folder")).toEqual(["node", "/my folder/tools/x.js"]);
    for (const c of ["node $CLAUDE_PROJECT_DIRX/x.js", "node '$CLAUDE_PROJECT_DIR'/x.js", "node ./a$CLAUDE_PROJECT_DIR/x.js", "node $HOME/x.js"]) {
      expect(() => commandWords(c, w), c).toThrow(FORM);
    }
  });

  it("a script that is no regular file in a root is refused: missing, outside, a folder, a link, a program on PATH", async () => {
    const outside = tree("g-out", { "z.js": "z" });
    fs.symlinkSync(path.join(w, "tools/x.js"), path.join(w, "link.js"));
    const why = async (c: string | string[]) => (await scan(c)).issues.map((i) => [path.relative(root, i.path), i.why]);
    expect(await why("node ./missing.js")).toEqual([["g/missing.js", "is not a script file in the folder or a linked folder"]]);
    expect(await why(`node ${outside}/z.js`)).toEqual([["g-out/z.js", "is not a script file in the folder or a linked folder"]]);
    expect(await why("node ../g-out/z.js")).toEqual([["g-out/z.js", "is not a script file in the folder or a linked folder"]]);
    expect(await why("node ./tools")).toEqual([["g/tools", "is a folder"]]);
    expect(await why("node .")).toEqual([["g", "is a folder"]]);
    expect(await why("node ./link.js")).toEqual([["g/link.js", "is a symbolic link"]]);
    expect(await why("git status")).toEqual([["g/git", "is not a script file in the folder or a linked folder"]]);
    expect(await why(["server"])).toEqual([["g/server", "is not a script file in the folder or a linked folder"]]);
  });

  it("an argument naming a root, a folder, a link or a FIFO in a root is refused; outside or missing, it is only a word", async () => {
    execFileSync("mkfifo", [path.join(w, "pipe")]);
    const why = async (c: string) => (await scan(c)).issues.map((i) => [path.relative(root, i.path), i.why]);
    expect(await why("node ./tools/x.js .")).toEqual([["g", "is a folder"]]);
    expect(await why("node ./tools/x.js tools")).toEqual([["g/tools", "is a folder"]]);
    expect(await why("node ./tools/x.js pipe")).toEqual([["g/pipe", "is not a regular file"]]);
    expect(await why("node ./tools/x.js --out=./link.js")).toEqual([["g/link.js", "is a symbolic link"]]);
    expect(await why("node ./tools/x.js nothing-here /etc/hosts ../up.js")).toEqual([]);
  });

  it("remote packages on a server: npx [-y] <name>[@version], uvx <name>[==version]; a root may be their argument", async () => {
    expect(await scan(["npx", "-y", "@modelcontextprotocol/server-filesystem", "."])).toEqual({ files: [], issues: [] });
    expect(await scan(["npx", "cowsay@1.2.0", "hi"])).toEqual({ files: [], issues: [] });
    expect(await scan(["uvx", "mcp-server-fetch==1.0"])).toEqual({ files: [], issues: [] });
    // But not a folder below it, nor in a hook.
    expect((await scan(["npx", "-y", "srv", "./tools"])).issues.map((i) => i.why)).toEqual(["is a folder"]);
    expect((await scan("npx -y srv")).issues.map((i) => [path.relative(root, i.path), i.why])).toEqual([["g/npx", "is not a script file in the folder or a linked folder"]]);
  });

  it("refuses a local npm or Python package", async () => {
    const l = tree("g-local", { "node_modules/.bin/localbin": "x", "node_modules/@s/kit/index.js": "k", "localmod.py": "m", "local_pkg/__init__.py": "" });
    const lo = { folder: l, linked: [] };
    const local = async (c: string[]) => (await scanScripts([c], lo)).issues.map((i) => path.relative(l, i.path));
    expect(await local(["npx", "localbin"])).toEqual(["node_modules/.bin/localbin"]);
    expect(await local(["npx", "-y", "@s/kit@1.0"])).toEqual(["node_modules/@s/kit"]);
    expect(await local(["uvx", "localmod"])).toEqual(["localmod.py"]);
    expect(await local(["uvx", "local-pkg"])).toEqual(["local_pkg"]);
    for (const c of [["npx", "./tools"], ["npx", "file:../x"], ["npx", "-p", "x", "y"], ["npx", "-c", "node ."], ["npx", "--yes"], ["uvx", "--from", ".", "x"], ["uvx", "./pkg"]]) {
      expect(() => commandWords(c, l), c.join(" ")).toThrow(FORM);
    }
  });

  it("scriptRefs lists the hashed files and the refused paths together (a pin or a load compares them)", async () => {
    expect(await scriptRefs(["node ./tools/x.js", "node ./tools"], o)).toEqual([path.join(w, "tools"), path.join(w, "tools/x.js")]);
  });
});

describe("everything else is refused (probe 3, E2)", () => {
  const w = tree("p3", { "evil.js": "evil", "ok.js": "ok", "index.js": "i", "tools/a.js": "a", "pkg/__main__.py": "m", "node_modules/evilpkg/index.js": "e" });
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
    const refused = await scanScripts([command], o).then(
      (s) => s.issues.length > 0,
      (e: Error) => e.message.includes(FORM),
    );
    expect(refused).toBe(true);
  });

  it.each([
    ["node ./ok.js", ["ok.js"]],
    [["./ok.js"], ["ok.js"]],
    [["python3", "./ok.js", "--cfg=./evil.js"], ["evil.js", "ok.js"]],
  ] as const)("passes %j, hashing what it names", async (command, hashed) => {
    expect(await scanScripts([command as string | string[]], o)).toEqual({ files: hashed.map((f) => path.join(w, f)), issues: [] });
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
