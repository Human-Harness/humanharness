import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTools } from "../src/tool-build";

// The e2e can't build, so the tools fixture's dist/ is committed (tools Decision 16): this rebuilds it in memory and
// compares byte for byte, so a source change without `humanharness build` fails here.
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/tools-harness");
const DIST = path.join(FIXTURE, "dist");

/** Every file under `dir`, relative with "/", sorted. */
function files(dir: string, rel = ""): string[] {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]))
    .sort();
}

describe("the tools e2e fixture", () => {
  it("the tools fixture's dist matches a fresh build", async () => {
    const built = await buildTools(FIXTURE, { write: false });
    expect(files(DIST)).toEqual([...built.files.keys()].sort());
    for (const [name, content] of built.files) {
      const fresh = Buffer.from(content);
      expect(fs.readFileSync(path.join(DIST, name)).equals(fresh), name).toBe(true);
    }
    expect(Object.keys(built.json.tools)).toEqual(["check-key", "count-notes", "hidden", "peek-folder", "probe"]);
  }, 120_000);
});
