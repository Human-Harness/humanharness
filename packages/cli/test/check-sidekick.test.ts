import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type CheckResult, checkHarness } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

// Not about mods: the template's untouched sample mod passes without a real build (stub-mod-check.ts).
vi.mock("../src/kit/check", async (real) => (await import("./stub-mod-check")).withStub(await real<typeof import("../src/kit/check")>()));

// Not about the build: the tools build once per distinct set of tool sources, not once per test (cached-tool-build.ts).
vi.mock("../src/tool-build", async (real) => (await import("./cached-tool-build")).withCache(await real<typeof import("../src/tool-build")>()));

const { root, cleanup } = tempRoot("hh-check-sidekick-");
afterAll(cleanup);
let n = 0;

/** A fresh harness repo from the template, changed by `edit`. Each one has its own folder: manifests are imported once. */
async function fixture(edit: (dir: string) => void = () => {}): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  edit(dir);
  return dir;
}
const errors = (r: CheckResult) => r.findings.filter((f) => f.severity === "error");

describe("check: sidekick (sidekick spec §3)", () => {
  const AFTER = '  questions: { tier: "light" },';
  const withSidekick = (block: string) => (d: string) => replaceIn(d, "harness.config.ts", "mods: { example: {} },", `mods: { example: {}, sidekick: ${block} },`);
  const rules = (r: CheckResult) =>
    r.findings.filter((f) => f.rule === "sidekick-tips" || f.message.startsWith("mods.sidekick")).map((f) => `${f.severity}:${f.rule}`);

  it("short tips and known actions: no finding", async () => {
    const r = await checkHarness(await fixture(withSidekick('{ default: "off", tips: "Claims need a source." }')));
    expect(errors(r)).toEqual([]);
    expect(rules(r)).toEqual([]);
  });

  it("an unknown action is a schema error, reported once", async () => {
    const r = await checkHarness(await fixture(withSidekick('{ actions: { nope: "auto" } }')));
    expect(rules(r)).toEqual(["error:schema"]);
  });

  it("a top-level sidekick key is a schema error naming mods.sidekick", async () => {
    const r = await checkHarness(await fixture((d) => replaceIn(d, "harness.config.ts", AFTER, `${AFTER}\n  sidekick: {},`)));
    expect(errors(r).map((f) => f.message)).toEqual([expect.stringContaining("mods.sidekick")]);
  });

  it("sidekick-tips: warns over 300 tokens, per purpose too", async () => {
    const long = JSON.stringify("Every claim needs a source from the reading list, cited in APA style with page numbers. ".repeat(20).trim());
    for (const tips of [long, `{ "prompt-coach": ${long} }`]) {
      const r = await checkHarness(await fixture(withSidekick(`{ tips: ${tips} }`)));
      const found = r.findings.filter((f) => f.rule === "sidekick-tips");
      expect(found.map((f) => f.severity)).toEqual(["warning"]);
      expect(found[0].message).toMatch(/^Sidekick's tips take about \d+ tokens \(more than 300\)/);
    }
  });
});
