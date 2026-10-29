import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandWords, scriptRefs } from "../../src/main/engine-config/script-refs";

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

  it("ignores a referenced symlink and a directory", async () => {
    const w = tree("w4", { "real.js": "r", "dir/a.js": "a" });
    fs.symlinkSync(path.join(w, "real.js"), path.join(w, "link.js"));
    expect(await scriptRefs(["node ./link.js", "ls ./dir", "ls ."], { folder: w, linked: [] })).toEqual([]);
  });

  it("ignores a file reached through a symlinked folder that points outside", async () => {
    const w = tree("w5", {});
    const outside = tree("outside5", { "hosts": "h" });
    fs.symlinkSync(outside, path.join(w, "tools"));
    expect(await scriptRefs(["cat ./tools/hosts"], { folder: w, linked: [] })).toEqual([]);
  });

  it("ignores ../ escapes and home paths", async () => {
    const w = tree("w6/inner", {});
    tree("w6", { "up.js": "u" });
    expect(await scriptRefs(["node ../up.js", "node ~/x.js"], { folder: w, linked: [] })).toEqual([]);
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
