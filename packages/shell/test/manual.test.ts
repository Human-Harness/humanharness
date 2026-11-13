import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HH_DTS_COMMAND, HH_DTS_FILE, generateHhDts, publicNames } from "../scripts/hh-dts";
import { writeLayers } from "../src/main/mods/home-folder";
import { agentsMd, manualFiles } from "../src/main/mods/manual";

describe("hh.d.ts", () => {
  it("is what the script generates from this version's sources, byte for byte", async () => {
    const fresh = await generateHhDts();
    const checkedIn = readFileSync(HH_DTS_FILE, "utf8");
    expect(fresh === checkedIn, `packages/shell/scripts/hh.d.ts is stale: run \`${HH_DTS_COMMAND}\``).toBe(true);
  }, 60_000);

  it("declares the two public modules and the mod API's names", () => {
    const dts = manualFiles()["hh.d.ts"];
    expect(dts).toContain('declare module "@humanharness/mod-sdk" {');
    expect(dts).toContain('declare module "@humanharness/ui" {');
    const names = publicNames(dts);
    for (const n of ["defineMod", "MainCtx", "UiCtx", "layoutSchema", "modJsonSchema", "BlockProps", "AppValue", "useApp", "Rx"]) expect(names).toContain(n);
    // The bundler is node-only, not part of a mod's API.
    expect(names).not.toContain("bundleMod");
  });
});

describe("AGENTS.md", () => {
  it("names every exported name of hh.d.ts (spec §8)", () => {
    const text = agentsMd();
    const missing = publicNames(manualFiles()["hh.d.ts"]).filter((n) => !new RegExp(`\\b${n}\\b`).test(text));
    expect(missing).toEqual([]);
  });

  it("covers the layers, the layout, the imports, consent, reload, the commands and the ways back", () => {
    const text = agentsMd();
    for (const s of [
      "core/",
      "harness/",
      "read-only",
      "mods/<id>/",
      "layouts/<name>.json",
      "settings.json",
      '"home"',
      '"work"',
      '{ "core": "task" }',
      "clonedFrom",
      "zod",
      "react",
      ".error",
      "humanharness mod check",
      "humanharness status",
      "humanharness shot",
      "humanharness mod clone",
      "humanharness layout clone",
      "--safe",
      "Settings › Mods",
    ]) {
      expect(text, s).toContain(s);
    }
  });
});

describe("a start", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-manual-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes AGENTS.md and hh.d.ts into the home folder, outside the layers' edit check", async () => {
    const home = path.join(tmp, "app");
    const notice = vi.fn();
    const empty = { mods: {}, layouts: {} };
    await writeLayers({ home, core: empty, harness: empty, notice, manual: manualFiles() });
    expect(await fs.readFile(path.join(home, "AGENTS.md"), "utf8")).toBe(agentsMd());
    expect(await fs.readFile(path.join(home, "hh.d.ts"), "utf8")).toBe(readFileSync(HH_DTS_FILE, "utf8"));
    const record = JSON.parse(await fs.readFile(path.join(home, ".layers.json"), "utf8")) as Record<string, string>;
    expect(Object.keys(record)).toEqual([]);
    // An edit is simply rewritten on the next start: no move, no notice.
    await fs.writeFile(path.join(home, "AGENTS.md"), "mine");
    await writeLayers({ home, core: empty, harness: empty, notice, manual: manualFiles() });
    expect(await fs.readFile(path.join(home, "AGENTS.md"), "utf8")).toBe(agentsMd());
    expect(notice).not.toHaveBeenCalled();
  });
});
