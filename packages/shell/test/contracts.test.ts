import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareHhDts } from "../scripts/contracts";

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
