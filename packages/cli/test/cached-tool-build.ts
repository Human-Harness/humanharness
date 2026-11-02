import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import type * as ToolBuild from "../src/tool-build";

/**
 * For tests about something other than the build (check rules, dev, run): the tools build once per distinct set of
 * tool sources in a test file, not once per test. A tool build is ~2 s of esbuild (the zod bundle goes through the
 * plugin's resolver, thousands of async calls) and `check` runs it, so a file that makes a harness per test spent
 * most of its time repeating the same build, and under a parallel run that crossed the 30 s test timeout.
 *
 * Use it as `vi.mock("../src/tool-build", async (real) => (await import("./cached-tool-build")).withCache(await real()))`.
 * The key is each tool's id and path plus every file under the harness's tools/ folder, so a test that edits a tool
 * gets its own build. Failures are cached too, and a write (`dev`) writes what the build returned. Tests of the build
 * itself (tool-build.test.ts) never use this.
 */
export function withCache(real: typeof ToolBuild): typeof ToolBuild {
  const cache = new Map<string, Promise<Awaited<ReturnType<typeof ToolBuild.buildTools>>>>();
  const buildTools: typeof ToolBuild.buildTools = async (dir, o) => {
    const root = path.resolve(dir);
    const harness: LoadedHarness | undefined = o.harness;
    if (!harness) return real.buildTools(dir, o);
    const hash = createHash("sha256");
    for (const [id, file] of Object.entries(harness.tools ?? {}).sort()) hash.update(`${id}\0${file}\0`);
    for (const file of filesUnder(path.join(root, "tools"))) hash.update(`${path.relative(root, file)}\0`).update(fs.readFileSync(file)).update("\0");
    const key = hash.digest("hex");
    let hit = cache.get(key);
    if (!hit) {
      hit = real.buildTools(dir, { ...o, write: false });
      cache.set(key, hit);
    }
    const built = await hit;
    if (o.write) {
      const dist = path.join(root, "dist");
      fs.mkdirSync(path.join(dist, "tools"), { recursive: true });
      for (const [name, content] of built.files) fs.writeFileSync(path.join(dist, name), content);
    }
    return { json: built.json, files: new Map(built.files) };
  };
  return { ...real, buildTools };
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)])).sort();
}
