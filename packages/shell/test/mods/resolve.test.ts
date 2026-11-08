import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveMods } from "../../src/main/mods/resolve";

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/mods");

describe("resolveMods", () => {
  it("finds harness-declared mods in the harness folder, and local folders", async () => {
    const r = await resolveMods({ declared: { echo: { word: "hi" } }, harnessModsDir: fx, local: [path.join(fx, "broken")], core: {} });
    expect(r.mods.map((m) => [m.json.id, m.origin])).toEqual([["echo", "harness"], ["broken", "local"]]);
    expect(r.mods[0].config).toEqual({ word: "hi" });
    expect(r.problems).toEqual([]);
  });
  it("reports, without throwing, a declared mod that doesn't exist and a bad mod.json", async () => {
    const r = await resolveMods({ declared: { nope: {} }, harnessModsDir: fx, local: [path.join(fx, "badjson")], core: {} });
    expect(r.mods).toEqual([]);
    expect(r.problems.map((p) => p.id)).toEqual(["nope", path.join(fx, "badjson")]);
  });
  it("prefers a core mod over a harness folder of the same id", async () => {
    const core = { echo: { dir: path.join(fx, "echo") } };
    const r = await resolveMods({ declared: { echo: {} }, harnessModsDir: "/nowhere", local: [], core });
    expect(r.mods[0].origin).toBe("harness"); // declared by the harness, so its switch default is the harness's
    expect(r.mods[0].shipped).toBe("core");
  });
  it("refuses a local mod whose id is already taken", async () => {
    const r = await resolveMods({ declared: { echo: {} }, harnessModsDir: fx, local: [path.join(fx, "echo")], core: {} });
    expect(r.mods).toHaveLength(1);
    expect(r.problems[0].reason).toMatch(/already/);
  });
  it("lists core mods the harness doesn't declare, so the person can turn them on", async () => {
    const r = await resolveMods({ declared: undefined, harnessModsDir: "/x", local: [], core: { echo: { dir: path.join(fx, "echo") } } });
    expect(r.mods.map((m) => [m.json.id, m.origin, m.shipped])).toEqual([["echo", "core", "core"]]);
  });
  it("a local folder can't take a core id", async () => {
    const r = await resolveMods({ declared: undefined, harnessModsDir: "/x", local: [path.join(fx, "echo")], core: { echo: { dir: path.join(fx, "echo") } } });
    expect(r.mods.map((m) => m.origin)).toEqual(["core"]);
    expect(r.problems[0].reason).toMatch(/already/);
  });
});
