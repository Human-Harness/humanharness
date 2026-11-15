import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseHarnesses } from "./release-harnesses";

const dirs: string[] = [];
function fixture(harnesses: Record<string, string | null>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rh-"));
  dirs.push(root);
  for (const [id, body] of Object.entries(harnesses)) {
    fs.mkdirSync(path.join(root, id));
    if (body !== null) fs.writeFileSync(path.join(root, id, "harness.config.ts"), body);
  }
  return root;
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("releaseHarnesses", () => {
  it("lists only harnesses with release: true, sorted", async () => {
    const root = fixture({
      teacher: "export default { release: true };",
      demo: "export default { name: 'x' };",
      alpha: "export default { release: true };",
      off: "export default { release: false };",
      empty: null,
    });
    expect(await releaseHarnesses(root)).toEqual(["alpha", "teacher"]);
  });

  it("is empty when none is marked", async () => {
    expect(await releaseHarnesses(fixture({ demo: "export default {};" }))).toEqual([]);
  });
});

describe("release-harnesses script", () => {
  it("exits 1 with the message when no harness has release: true, else prints the ids as JSON", async () => {
    const cwd = path.resolve(__dirname, "..");
    const r = spawnSync("node", ["--import", "tsx", "scripts/release-harnesses.ts"], { encoding: "utf8", cwd });
    const marked = await releaseHarnesses(path.join(cwd, "harnesses"));
    if (marked.length === 0) {
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("No harness has release: true");
    } else {
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual(marked);
    }
  }, 60_000);
});
