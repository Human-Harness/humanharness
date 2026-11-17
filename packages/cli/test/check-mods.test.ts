import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type CheckResult, checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

vi.mock("../src/tool-build", async (real) => (await import("./cached-tool-build")).withCache(await real<typeof import("../src/tool-build")>()));

const { root, cleanup } = tempRoot("hh-check-mods-");
afterAll(cleanup);
let n = 0;

/** A fresh harness repo from the template, changed by `edit`. Each one has its own folder: manifests are imported once. */
async function fixture(edit: (dir: string) => void = () => {}): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  edit(dir);
  return dir;
}
const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const of = (r: CheckResult, rule: string) => r.findings.filter((f) => f.rule === rule).map((f) => `${f.severity} ${f.file} ${f.message}`);

describe("check: mods and layouts", () => {
  it("finds nothing in the template's mods and layouts", async () => {
    const r = await checkHarness(await fixture());
    expect(of(r, "mod")).toEqual([]);
    expect(of(r, "layout")).toEqual([]);
  }, 60_000);

  it("a broken mod.json is an error with the schema's message", async () => {
    const dir = await fixture((d) => replaceIn(d, "mods/example/mod.json", '"version": "0.1.0"', '"version": "one"'));
    expect(of(await checkHarness(dir), "mod")).toEqual(["error mods/example/mod.json mods/example: mod.json: version version is x.y.z"]);
  }, 60_000);

  it("a mod.json whose id isn't its folder's name is an error", async () => {
    const dir = await fixture((d) => replaceIn(d, "mods/example/mod.json", '"id": "example"', '"id": "other"'));
    expect(of(await checkHarness(dir), "mod")).toContain(
      'error mods/example/mod.json mods/example: mod.json has id "other": a mod\'s id is its folder\'s name, "example".',
    );
  }, 60_000);

  it("a mod whose ui doesn't bundle is an error that names the part", async () => {
    const dir = await fixture((d) => write(d, "mods/example/ui.tsx", 'import "./nowhere";\n'));
    const found = of(await checkHarness(dir), "mod");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^error mods\/example\/mod\.json mods\/example: ui: /);
  }, 60_000);

  it("a layout missing work is an error with the file and the rule's message", async () => {
    const dir = await fixture((d) =>
      write(d, "layouts/main.json", JSON.stringify({ type: "stack", children: [{ type: "block", id: "home", content: { mod: "home", block: "home" } }] })),
    );
    expect(of(await checkHarness(dir), "layout")).toEqual([
      'error layouts/main.json layouts/main.json: The root must have a child with id "work"',
      'error layouts/main.json layouts/main.json: The layout must have exactly one { "core": "task" } block, it has 0',
    ]);
  }, 60_000);

  it("a layout that isn't JSON is an error", async () => {
    const dir = await fixture((d) => write(d, "layouts/side.json", "{"));
    expect(of(await checkHarness(dir), "layout")).toEqual(["error layouts/side.json layouts/side.json is not valid JSON."]);
  }, 60_000);

  it("a mod folder the manifest doesn't declare is a warning that names the fix", async () => {
    const dir = await fixture((d) => replaceIn(d, "harness.config.ts", "mods: { example: {} },", ""));
    expect(of(await checkHarness(dir), "mod")).toEqual([
      "warning mods/example mods/example is not in harness.config.ts → mods, so it is off: add `example: {}` to mods, or delete the folder.",
    ]);
  }, 60_000);

  it("a declared mod with no folder and no core mod of that id is an error", async () => {
    const dir = await fixture((d) => replaceIn(d, "harness.config.ts", "mods: { example: {} },", "mods: { example: {}, ghost: {}, home: {} },"));
    expect(of(await checkHarness(dir), "mod")).toEqual([
      "error harness.config.ts mods.ghost: there is no mods/ghost/ folder and no core mod with that id. Create the mod in mods/ghost/, or remove it from mods.",
    ]);
  }, 60_000);
});
