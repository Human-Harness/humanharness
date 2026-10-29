import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTools } from "../src/tool-build";

// The recipes e2e fixture's dist/ is committed as the tools fixture's is (tools Decision 16; slice 4): this rebuilds it
// in memory and compares byte for byte, so a source change without `humanharness build` fails here.
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/recipes-harness");
const DIST = path.join(FIXTURE, "dist");

/** Every file under `dir`, relative with "/", sorted. */
function files(dir: string, rel = ""): string[] {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]))
    .sort();
}

describe("the recipes e2e fixture", () => {
  it("the recipes fixture's dist matches a fresh build", async () => {
    const built = await buildTools(FIXTURE, { write: false });
    expect(files(DIST)).toEqual([...built.files.keys()].sort());
    for (const [name, content] of built.files) {
      const fresh = Buffer.from(content);
      expect(fs.readFileSync(path.join(DIST, name)).equals(fresh), name).toBe(true);
    }
    expect(Object.keys(built.json.tools)).toEqual(["apply-triage", "boom", "check-items"]);
  }, 120_000);
});
