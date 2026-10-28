import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_BYTES, FIXTURE_FILES, readPluginFixtures } from "../src/main/plugin-fixture-files";
import { tmp } from "./plugins-fixtures";

const FIXTURE = {
  kind: "fetch",
  request: { method: "GET", url: "https://api.example.com/q" },
  response: { status: 200, headers: {}, text: "ok" },
};

/** `<plugin>/fixtures/<source>/` with `files`; answers the fixtures folder. */
async function fixtures(source: string, files: Record<string, unknown>): Promise<string> {
  const dir = path.join(await tmp(), "fixtures");
  await fs.mkdir(path.join(dir, source), { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, source, name), typeof body === "string" ? body : JSON.stringify(body));
  return dir;
}

const logged = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(([m, e]) => `${String(m)}: ${e instanceof Error ? e.message : ""}`).join("\n");

describe("readPluginFixtures (the controller's and the CLI's fixture reader)", () => {
  it("reads <fixtures>/<source>/*.json in file-name order; a missing folder is no fixtures", async () => {
    const dir = await fixtures("q", { "002.json": { ...FIXTURE, response: { ...FIXTURE.response, text: "two" } }, "001.json": FIXTURE });
    const log = vi.fn();
    expect((await readPluginFixtures(dir, "q", log)).map((x) => (x.response as { text: string }).text)).toEqual(["ok", "two"]);
    expect(await readPluginFixtures(dir, "other", log)).toEqual([]);
    expect(await readPluginFixtures(path.join(dir, "nope"), "q", log)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(FIXTURE_FILES).toBe(200);
  });

  it("a file over 10 MB is logged and skipped, unread", async () => {
    const dir = await fixtures("q", { "002.json": FIXTURE });
    const big = path.join(dir, "q", "001.json");
    await fs.writeFile(big, "");
    await fs.truncate(big, FIXTURE_BYTES + 1);
    const log = vi.fn();
    expect(await readPluginFixtures(dir, "q", log)).toHaveLength(1);
    expect(logged(log)).toMatch(/fixtures\/q\/001\.json skipped: larger than 10 MB/);
  });

  it("a file of exactly 10 MB is read (and fails as JSON, not on size)", async () => {
    const dir = await fixtures("q", {});
    const f = path.join(dir, "q", "001.json");
    await fs.writeFile(f, "");
    await fs.truncate(f, FIXTURE_BYTES);
    const log = vi.fn();
    expect(await readPluginFixtures(dir, "q", log)).toEqual([]);
    expect(logged(log)).toMatch(/001\.json skipped/);
    expect(logged(log)).not.toMatch(/larger than/);
  });

  it("a linked fixtures/ folder, or a linked fixtures/<source> folder, is not followed", async () => {
    const real = await fixtures("q", { "001.json": FIXTURE });
    const log = vi.fn();
    const linkedRoot = path.join(await tmp(), "fixtures");
    await fs.symlink(real, linkedRoot);
    expect(await readPluginFixtures(linkedRoot, "q", log)).toEqual([]);
    const dir = await fixtures("other", {});
    await fs.symlink(path.join(real, "q"), path.join(dir, "q"));
    expect(await readPluginFixtures(dir, "q", log)).toEqual([]);
    expect(await readPluginFixtures(real, "q", log)).toHaveLength(1);
  });

  it("a file link or a hard link (a second name for a file elsewhere) is skipped", async () => {
    const outside = path.join(await tmp(), "outside.json");
    await fs.writeFile(outside, JSON.stringify(FIXTURE));
    const dir = await fixtures("q", { "003.json": FIXTURE });
    await fs.symlink(outside, path.join(dir, "q", "001.json"));
    await fs.link(outside, path.join(dir, "q", "002.json"));
    const log = vi.fn();
    expect(await readPluginFixtures(dir, "q", log)).toHaveLength(1);
    expect(logged(log)).toMatch(/002\.json skipped: a hard link/);
    expect(logged(log)).not.toMatch(/003\.json/);
  });
});
