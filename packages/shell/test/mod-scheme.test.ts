import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOD_SCHEME, type SchemeMod, serveModUi } from "../src/main/mods/mod-scheme";

let tmp: string;
let mods: Record<string, SchemeMod>;
const buildDir = (id: string) => path.join(tmp, "mod-build", id);
const json = (id: string, ui?: string) => ({ id, name: id, version: "0.1.0", apiVersion: 1 as const, requires: [], history: false, ...(ui ? { ui } : {}) });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-mod-scheme-"));
  for (const id of ["mine", "off"]) {
    await fs.mkdir(buildDir(id), { recursive: true });
    await fs.writeFile(path.join(buildDir(id), "ui.js"), `export const who = "${id} built";\n`);
  }
  for (const id of ["local", "core", "noui"]) {
    await fs.mkdir(path.join(tmp, id, "dist"), { recursive: true });
    await fs.writeFile(path.join(tmp, id, "dist", "ui.js"), `export const who = "${id}";\n`);
  }
  await fs.writeFile(path.join(tmp, "secret.txt"), "secret");
  mods = {
    mine: { mod: { json: json("mine", "ui.tsx"), dir: path.join(tmp, "src-mine"), origin: "local", shipped: "local", config: undefined, user: true }, on: true },
    off: { mod: { json: json("off", "ui.tsx"), dir: path.join(tmp, "src-off"), origin: "local", shipped: "local", config: undefined, user: true }, on: false },
    local: { mod: { json: json("local", "dist/ui.js"), dir: path.join(tmp, "local"), origin: "local", shipped: "local", config: undefined }, on: true },
    core: { mod: { json: json("core", "dist/ui.js"), dir: path.join(tmp, "core"), origin: "core", shipped: "core", config: undefined }, on: true },
    noui: { mod: { json: json("noui"), dir: path.join(tmp, "noui"), origin: "local", shipped: "local", config: undefined }, on: true },
  };
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

const get = (url: string) => serveModUi(url, { mod: (id) => mods[id], buildDir });

describe("hh-mod://", () => {
  it("is standard and secure, without bypassCSP", () => {
    expect(MOD_SCHEME).toEqual({ scheme: "hh-mod", privileges: { standard: true, secure: true } });
  });

  it("serves an on user mod's built ui, as JavaScript, not cached", async () => {
    const r = await get("hh-mod://mine/ui.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/javascript");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toContain("mine built");
  });

  it("serves an on local (non-user) mod's ui from its folder", async () => {
    const r = await get("hh-mod://local/ui.js");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('"local"');
  });

  it("404s an off mod, a core mod, a mod with no ui, an unknown id, another path and ..", async () => {
    for (const url of [
      "hh-mod://off/ui.js",
      "hh-mod://core/ui.js",
      "hh-mod://noui/ui.js",
      "hh-mod://nope/ui.js",
      "hh-mod://mine/main.mjs",
      "hh-mod://mine/last-good/ui.js",
      "hh-mod://mine/../../secret.txt",
      "hh-mod://mine/%2e%2e/%2e%2e/secret.txt",
      "hh-mod://mine/ui.js/..",
      "hh-mod://Bad!/ui.js",
      "https://mine/ui.js",
    ]) {
      expect((await get(url)).status, url).toBe(404);
    }
  });

  it("404s when the built file is missing", async () => {
    await fs.rm(path.join(buildDir("mine"), "ui.js"));
    expect((await get("hh-mod://mine/ui.js")).status).toBe(404);
  });
});
