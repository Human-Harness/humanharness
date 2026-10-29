import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scriptRefs } from "../../src/main/engine-config/script-refs";

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
