import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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

describe("scriptRefs (spec §5.3, E2)", () => {
  it("finds relative and absolute paths inside the folder or a linked folder that exist as files", async () => {
    const w = tree("w1", { "tools/x.js": "x", eslint: "" });
    fs.rmSync(path.join(w, "eslint"));
    const repo = tree("repo1", { "bin/y.sh": "y" });
    const outside = tree("outside1", { "z.js": "z" });
    const found = await scriptRefs(
      ["node ./tools/x.js --fast", `bash ${repo}/bin/y.sh`, "npx eslint", `node ${outside}/z.js`, "node ./tools/x.js"],
      { folder: w, linked: [repo] },
    );
    expect(found).toEqual([path.join(w, "tools/x.js"), path.join(repo, "bin/y.sh")].sort());
  });

  it("takes server commands as tokens, and a flag's value after =", async () => {
    const w = tree("w2", { "srv.js": "s", "conf/a.json": "{}" });
    const found = await scriptRefs([["node", "./srv.js"], "tool --config=./conf/a.json"], { folder: w, linked: [] });
    expect(found).toEqual([path.join(w, "conf/a.json"), path.join(w, "srv.js")]);
  });

  it('tokenizes quotes: node "./my tools/x.js"', async () => {
    const w = tree("w3", { "my tools/x.js": "x", "it's/y.js": "y" });
    const found = await scriptRefs([`node "./my tools/x.js"`, `node './it'\\''s/y.js'`], { folder: w, linked: [] });
    expect(found).toEqual([path.join(w, "it's/y.js"), path.join(w, "my tools/x.js")]);
  });

  it("names a referenced symlink and a folder, so the reader refuses them; never the folder itself", async () => {
    const w = tree("w4", { "real.js": "r", "dir/a.js": "a" });
    const repo = tree("repo4", { "lib/b.js": "b" });
    fs.symlinkSync(path.join(w, "real.js"), path.join(w, "link.js"));
    const o = { folder: w, linked: [repo] };
    const found = await scriptRefs(["node ./link.js", "ls ./dir", "ls .", `ls ${repo}`, `node ${repo}/lib`], o);
    expect(found).toEqual([path.join(w, "dir"), path.join(w, "link.js"), path.join(repo, "lib")].sort());
    const { files, issues } = await scanScripts(["node ./link.js", "ls ./dir", "node ./real.js"], o);
    expect(files).toEqual([path.join(w, "real.js")]);
    expect(issues).toEqual([
      { path: path.join(w, "dir"), why: "is a folder", command: "ls ./dir" },
      { path: path.join(w, "link.js"), why: "is a symbolic link", command: "node ./link.js" },
    ]);
  });

  it("names a file reached through a symlinked folder, inside or pointing outside", async () => {
    const w = tree("w5", { "lib/x.js": "x" });
    const outside = tree("outside5", { "hosts": "h" });
    fs.symlinkSync(outside, path.join(w, "tools"));
    fs.symlinkSync(path.join(w, "lib"), path.join(w, "alias"));
    const o = { folder: w, linked: [] };
    const { files, issues } = await scanScripts(["cat ./tools/hosts", "node ./alias/x.js"], o);
    expect(files).toEqual([]);
    expect(issues.map((i) => [i.path, i.why])).toEqual([
      [path.join(w, "alias/x.js"), "is reached through a symbolic link"],
      [path.join(w, "tools/hosts"), "is reached through a symbolic link"],
    ]);
  });

  it("ignores ../ escapes and home paths", async () => {
    const w = tree("w6/inner", {});
    tree("w6", { "up.js": "u" });
    expect(await scriptRefs(["node ../up.js", ["node", "~/x.js"]], { folder: w, linked: [] })).toEqual([]);
    // In hook text `~` is the home folder: refused, never expanded.
    await expect(scriptRefs(["node ~/x.js"], { folder: w, linked: [] })).rejects.toThrow("uses ~");
  });
});

describe("commandWords: shell forms (E2)", () => {
  const folder = "/w";
  it("reads sh/bash/zsh/dash -c scripts again", () => {
    expect(commandWords(`sh -c "node ./tools/x.js"`, folder)).toEqual(["sh", "-c", "node ./tools/x.js", "node", "./tools/x.js"]);
    expect(commandWords(`bash -lc 'zsh -c "./a.sh"'`, folder)).toContain("./a.sh");
    expect(commandWords(["/bin/dash", "-e", "-c", "node ./b.js"], folder)).toContain("./b.js");
  });
  it("takes $CLAUDE_PROJECT_DIR and ${CLAUDE_PROJECT_DIR} as the folder", () => {
    expect(commandWords(`node "$CLAUDE_PROJECT_DIR"/tools/x.js`, "/my folder")).toEqual(["node", "/my folder/tools/x.js"]);
    expect(commandWords("node ${CLAUDE_PROJECT_DIR}/x.js", folder)).toEqual(["node", "/w/x.js"]);
  });
  it.each([
    ["node $HOME/x.js", "uses $"],
    ["node $CLAUDE_PROJECT_DIRX/x.js", "uses $"],
    ["sh -c 'node $X'", "uses $"],
    ["node `pwd`/x.js", "backquote"],
    ["node ./tools/*.js", "glob"],
    ["node ./x?.js", "glob"],
    ["node ./[ab].js", "glob"],
    ["cd tools && node x.js", "changes folder (cd)"],
    ["sh -c 'pushd t; node x.js'", "changes folder (pushd)"],
  ])("refuses %s", (command, message) => {
    expect(() => commandWords(command, folder)).toThrow(message);
  });
  it("a server's own arguments are not shell: $ and globs pass there, a -c script is still read", () => {
    expect(commandWords(["node", "./srv.js", "--glob=*.ts", "$X"], folder)).toEqual(["node", "./srv.js", "--glob=*.ts", "$X"]);
    expect(() => commandWords(["bash", "-c", "cd x && ./y"], folder)).toThrow("changes folder");
  });
  it("scriptRefs finds a script through sh -c and $CLAUDE_PROJECT_DIR", async () => {
    const w = tree("w7", { "tools/x.js": "x", "b.sh": "b" });
    const found = await scriptRefs([`sh -c "node ./tools/x.js"`, `bash -c '"$CLAUDE_PROJECT_DIR"/b.sh'`], { folder: w, linked: [] });
    expect(found).toEqual([path.join(w, "b.sh"), path.join(w, "tools/x.js")]);
  });
});

describe("scanScripts fails closed (E2, E8: what a command runs must be fully accounted for)", () => {
  const w = tree("atk", { "target.js": "evil", "tools/ok.js": "ok", "index.js": "idx", "pkg/index.js": "p" });
  fs.symlinkSync(path.join(w, "target.js"), path.join(w, "run.js"));
  execFileSync("mkfifo", [path.join(w, "fifo")]);
  const outLink = path.join(root, "atk-outlink.js");
  fs.symlinkSync(path.join(w, "target.js"), outLink);
  const worklink = path.join(root, "atk-worklink");
  fs.symlinkSync(w, worklink);
  const o = { folder: w, linked: [] as string[] };
  const why = async (c: string | string[], opt = o) => {
    const { issues } = await scanScripts([c], opt);
    return issues.map((i) => [path.relative(root, i.path), i.why]);
  };

  it.each([
    ["node run.js", "atk/run.js", "is a symbolic link"],
    ["node ./run.js", "atk/run.js", "is a symbolic link"],
    ["node ./Run.js", "atk/Run.js", "is a symbolic link"],
    ["node ./tools/../run.js", "atk/run.js", "is a symbolic link"],
    ["node pkg", "atk/pkg", "is a folder: the program would run a file in it the approval doesn't cover"],
    ["node .", "atk", "is a folder: the program would run a file in it the approval doesn't cover"],
    ["node ./", "atk", "is a folder: the program would run a file in it the approval doesn't cover"],
    ["node fifo", "atk/fifo", "is not a regular file"],
    ["cat fifo", "atk/fifo", "is not a regular file"],
    ["node ../atk-outlink.js", "atk-outlink.js", "is a link into the folder"],
    ["bash -o pipefail -c 'node ./run.js'", "atk/run.js", "is a symbolic link"],
    ["bash -O extglob -c 'node ./run.js'", "atk/run.js", "is a symbolic link"],
    ["sh -c 'node run.js'", "atk/run.js", "is a symbolic link"],
    ["node --require=./run.js ./tools/ok.js", "atk/run.js", "is a symbolic link"],
    ["node -r./run.js ./tools/ok.js", "atk/run.js", "is a symbolic link"],
    ["node -r dotenv/config ./tools/ok.js", "atk/dotenv/config", "is not a script file in the folder (node loads it first)"],
    ["python -c 'x' ./run.js", "atk/run.js", "is a symbolic link"],
    ["exec node ./run.js", "atk/run.js", "is a symbolic link"],
    ["env -i node ./run.js", "atk/run.js", "is a symbolic link"],
    [". ./run.js", "atk/run.js", "is a symbolic link"],
    ["tool --x=./run.js", "atk/run.js", "is a symbolic link"],
  ])("refuses %s", async (command, file, reason) => {
    expect(await why(command)).toEqual([[file, reason]]);
  });

  it("refuses an absolute path that links into the folder, and paths through a linked work folder", async () => {
    expect(await why(`node ${outLink}`)).toEqual([["atk-outlink.js", "is a link into the folder"]]);
    expect(await why(`node ${w}/`)).toEqual([["atk", "is a folder: the program would run a file in it the approval doesn't cover"]]);
    // The work folder given through a link: the run.js link is refused whichever way it is named.
    for (const c of ["node ./run.js", "node run.js"]) {
      expect((await why(c, { folder: worklink, linked: [] })).map((r) => r[1]), c).toEqual(["is a symbolic link"]);
    }
    expect((await why(`node ${w}/run.js`, { folder: worklink, linked: [] })).map((r) => r[1])).toEqual(["is a link into the folder"]);
  });

  it("a server's first argument is its script: a root or a folder there is refused; elsewhere a root is data", async () => {
    expect(await why(["mcp-tool", "."])).toEqual([["atk", "is a folder: the program would run a file in it the approval doesn't cover"]]);
    expect(await why(["npx", "-y", "@scope/server-filesystem", "."])).toEqual([]);
    expect(await why(`ls ${w}`)).toEqual([]);
  });

  it.each([
    ["cat fifo | sh", "reading commands from its input"],
    ["sh", "reading commands from its input"],
    ["sh -s", "reading commands from its input"],
    ["node -", "reads its script from its input"],
    ["eval 'node ./run.js'", "uses eval"],
    ["xargs node", "xargs"],
    ["NODE_OPTIONS=--require=./run.js node ./tools/ok.js", "sets NODE_OPTIONS"],
    ["NODE_OPTIONS=--require=./target.js node ./tools/ok.js", "sets NODE_OPTIONS"],
    ["env BASH_ENV=./x.sh bash ./tools/ok.js", "sets BASH_ENV"],
    ["env -S 'node x'", "runs env with -S"],
    ["LD_PRELOAD=./x.so node ./tools/ok.js", "sets LD_PRELOAD"],
    ["PATH=./bin:/usr/bin tool", "sets PATH"],
    [`node ~${w.slice(os.homedir().length)}/target.js`, "uses ~"],
    ["bash --rcfile ./x -c 'true'", "with --rcfile"],
    ["bash -o", "with -o"],
    ["command -p node x", "in a form the check doesn't read"],
    ["sh -c 'node \"unclosed'", "leaves a quote open"],
  ])("refuses %s as a whole", async (command, message) => {
    await expect(scanScripts([command], o)).rejects.toThrow(message);
  });

  it("plain commands still hash their scripts", async () => {
    const { files, issues } = await scanScripts(
      ["node ./tools/ok.js", "FOO=1 node ./target.js", "bash -o pipefail -c 'node ./index.js | cat'", ["node", "./tools/ok.js"], "python3 -u ./target.js"],
      o,
    );
    expect(issues).toEqual([]);
    expect(files).toEqual([path.join(w, "index.js"), path.join(w, "target.js"), path.join(w, "tools/ok.js")]);
  });
});

describe("programs that run code from the folder's own config (E2)", () => {
  const w = tree("cfg", { "tools/ok.js": "ok", "localmod.py": "x", "localpkg/__init__.py": "", "node_modules/.bin/localbin": "x", "node_modules/@s/kit/index.js": "k", "test/a.js": "a" });
  const o = { folder: w, linked: [] as string[] };
  const issues = async (c: string | string[]) => (await scanScripts([c], o)).issues.map((i) => [path.relative(w, i.path), i.why.split(":")[0]]);

  it("a bare word naming a folder passes as data; a path to one, a link or a FIFO is still refused", async () => {
    execFileSync("mkfifo", [path.join(w, "pipe")]);
    fs.symlinkSync(path.join(w, "tools/ok.js"), path.join(w, "ln"));
    expect(await issues("ls test")).toEqual([]);
    expect(await issues(["rsync", "-a", "test", "/tmp/x"])).toEqual([]);
    expect(await issues("ls ./test")).toEqual([["test", "is a folder"]]);
    expect(await issues("cat pipe")).toEqual([["pipe", "is not a regular file"]]);
    expect(await issues("cat ln")).toEqual([["ln", "is a symbolic link"]]);
    // As an interpreter's script or a server's first argument, a bare folder is still refused.
    expect(await issues("node test")).toEqual([["test", "is a folder"]]);
    expect(await issues(["mcp-tool", "test"])).toEqual([["test", "is a folder"]]);
  });

  it.each([
    "npm run build",
    "npm test",
    "npm start",
    "npm --silent run x",
    "pnpm test",
    "pnpm build-docs",
    "pnpm exec tsc",
    "yarn lint",
    "yarn exec x",
    "bun run dev",
    "bun test",
    "bun lint",
    "make",
    "make test",
    "just fmt",
    "rake",
    "gradle build",
    "cargo run",
    "go run .",
    "deno task dev",
    "uv run tool",
    "poetry run pytest",
    ["npm", "start"],
    ["make", "serve"],
  ])("refuses %s", async (command) => {
    await expect(scanScripts([command], o)).rejects.toThrow(/runs code from the folder's own config/);
  });

  it.each([
    ["npx localbin", "node_modules/.bin/localbin"],
    ["npx -y @s/kit@1.0", "node_modules/@s/kit"],
    ["npx --package=./tools x", "tools"],
    ["npm exec localbin", "node_modules/.bin/localbin"],
    ["pnpm dlx localbin", "node_modules/.bin/localbin"],
    ["bunx ./tools", "tools"],
    ["python -m localmod", "localmod.py"],
    ["python3 -m localpkg.sub", "localpkg"],
    ["uvx localmod", "localmod.py"],
    ["uvx --from ./tools x", "tools"],
    ["uv tool run localpkg", "localpkg"],
  ])("refuses %s (a local package or module)", async (command, local) => {
    expect(await issues(command)).toEqual([[local, expect.stringMatching(/^is a local (package|module)$/)]]);
  });

  it("remote packages and modules pass (the npx/uvx hint covers them), and so do commands that run nothing local", async () => {
    for (const c of ["npx -y @modelcontextprotocol/server-filesystem .", "bunx cowsay hi", "uvx mcp-server-fetch", "python -m json.tool ./tools/ok.js", "npm install", "pnpm add x", "yarn install", "node ./tools/ok.js"]) {
      expect(await issues(c), c).toEqual([]);
    }
  });
});

