import { MOD_API_VERSION } from "@humanharness/mod-sdk";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { z } from "zod";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accept, checkRepo, compareHhDts, compareModJson, mergeVerdicts, readContract, RELEASED_DIR } from "../scripts/contracts";

const FIX = path.join(import.meta.dirname, "fixtures", "contracts");
const pair = (c: string) => ({
  frozen: readFileSync(path.join(FIX, c, "frozen.d.ts.txt"), "utf8"),
  current: readFileSync(path.join(FIX, c, "current.d.ts.txt"), "utf8"),
  roles: JSON.parse(readFileSync(path.join(FIX, c, "roles.json"), "utf8")) as Record<string, "host" | "mod" | "both">,
});

describe("hh.d.ts check", () => {
  const cases: [string, "same" | "additive" | "breaking", string[]][] = [
    ["same", "same", []],
    ["removed-export", "breaking", ["defineMod"]],
    ["new-export", "additive", ["Extra"]],
    ["host-member", "additive", ["TaskRef"]],
    ["mod-required", "breaking", ["SendVerdict"]],
    ["mod-optional", "additive", ["SendVerdict"]],
    ["both-widened", "breaking", ["Tier"]],
    ["param-narrowed", "breaking", ["defineMod"]],
    ["param-optional", "additive", ["defineMod"]],
    ["method-param", "breaking", ["MainCtx"]],
  ];
  for (const [c, result, names] of cases) {
    it(`${c} → ${result}`, async () => {
      const r = await compareHhDts(pair(c));
      expect(r.result).toBe(result);
      expect(r.names).toEqual(names);
    }, 60_000);
  }

  it("an exported type with no role fails, naming the type and roles.json", async () => {
    await expect(compareHhDts(pair("no-role"))).rejects.toThrow(/Extra.*packages\/mod-sdk\/released\/roles\.json/s);
  }, 60_000);
});

describe("the repo's contract", () => {
  it("matches the frozen copy (run `corepack pnpm --filter @humanharness/shell contracts accept` after a contract change)", async () => {
    const r = await checkRepo();
    expect(r, `contract ${r.result}: ${r.names.join(", ")}; run \`corepack pnpm --filter @humanharness/shell contracts accept\``).toEqual({ result: "same", names: [] });
  }, 60_000);

  it("contract.json, the newest vN files and MOD_API_VERSION agree (spec §2)", () => {
    const { apiVersion } = readContract();
    const versions = readdirSync(RELEASED_DIR).flatMap((f) => /^hh\.v(\d+)\.d\.ts$/.exec(f)?.[1] ?? []).map(Number);
    expect(Math.max(...versions)).toBe(apiVersion);
    expect(apiVersion).toBe(MOD_API_VERSION);
  });
});

describe("mod.json check", () => {
  const load = (c: string) => {
    const dir = path.join(FIX, "mod-json", c);
    const examples = Object.fromEntries(readdirSync(path.join(dir, "examples")).map((f) => [f, JSON.parse(readFileSync(path.join(dir, "examples", f), "utf8")) as unknown]));
    return { frozenSchema: JSON.parse(readFileSync(path.join(dir, "frozen.schema.json"), "utf8")), examples };
  };
  const version = z.string().regex(/^\d+\.\d+\.\d+$/);
  const cases: [string, z.ZodType, "same" | "additive" | "breaking", string[]][] = [
    ["same", z.strictObject({ id: z.string(), version, history: z.boolean().default(false), ui: z.string().optional() }), "same", []],
    ["removed", z.strictObject({ id: z.string(), version, history: z.boolean().default(false) }), "breaking", ["example.with-ui.json", "properties.ui"]],
    ["newly-required", z.strictObject({ id: z.string(), version, history: z.boolean(), ui: z.string().optional() }), "breaking", ["required.history"]],
    ["example-fails", z.strictObject({ id: z.string(), version: z.string().regex(/^\d+\.\d+$/), history: z.boolean().default(false), ui: z.string().optional() }), "breaking", ["example.minimal.json", "example.with-ui.json"]],
    ["new-optional", z.strictObject({ id: z.string(), version, history: z.boolean().default(false), ui: z.string().optional(), icon: z.string().optional() }), "additive", ["properties.icon"]],
  ];
  for (const [c, current, result, names] of cases) {
    it(`${c} → ${result}`, async () => {
      const r = await compareModJson({ ...load(c), current });
      expect(r.result).toBe(result);
      expect(r.names).toEqual(expect.arrayContaining(names));
    });
  }

  it("merges: breaking wins, mod.json names are prefixed", () => {
    expect(mergeVerdicts({ result: "additive", names: ["A"] }, { result: "breaking", names: ["properties.ui"] })).toEqual({ result: "breaking", names: ["mod.json:properties.ui"] });
    expect(mergeVerdicts({ result: "same", names: [] }, { result: "additive", names: ["properties.icon"] })).toEqual({ result: "additive", names: ["mod.json:properties.icon"] });
  });
});

describe("accept with frozen true", () => {
  const hashes = (dir: string) =>
    Object.fromEntries(
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => path.join(e.parentPath, e.name))
        .map((f) => [path.relative(dir, f), createHash("sha256").update(readFileSync(f)).digest("hex")]),
    );
  const temp = (frozen: boolean) => {
    const dir = mkdtempSync(path.join(tmpdir(), "released-"));
    cpSync(RELEASED_DIR, dir, { recursive: true });
    writeFileSync(path.join(dir, "contract.json"), `${JSON.stringify({ apiVersion: 1, frozen }, null, 2)}\n`);
    return dir;
  };
  const withoutUi = z.strictObject({ id: z.string(), name: z.string(), version: z.string(), apiVersion: z.literal(1), requires: z.array(z.string()).default([]), history: z.boolean().default(false), main: z.string().optional() });

  it("refuses a breaking change and writes nothing", async () => {
    const dir = temp(true);
    try {
      const before = hashes(dir);
      const r = await accept({ dir, currentSchema: withoutUi, modApiVersion: 1 });
      expect(r.refused).toMatch(/^breaking: .*mod\.json:properties\.ui.*Bump MOD_API_VERSION in packages\/mod-sdk\/src\/mod-json\.ts, then run accept again\.$/);
      expect(hashes(dir)).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a bump writes the v2 files and keeps v1", async () => {
    const dir = temp(true);
    try {
      const before = hashes(dir);
      const r = await accept({ dir, currentSchema: withoutUi, modApiVersion: 2 });
      expect(r.refused).toBeUndefined();
      const after = hashes(dir);
      for (const [f, h] of Object.entries(before)) if (/\.v1\./.test(f)) expect(after[f]).toBe(h);
      for (const f of ["hh.v2.d.ts", "mod-json.v2.schema.json", "mod-json.v2.examples/minimal.json"]) expect(after).toHaveProperty([f]);
      expect(JSON.parse(readFileSync(path.join(dir, "mod-json.v2.examples", "minimal.json"), "utf8")).apiVersion).toBe(2);
      expect(readContract(dir)).toEqual({ apiVersion: 2, frozen: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
