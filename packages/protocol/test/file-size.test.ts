import { describe, expect, it } from "vitest";
import { CAP, countedFiles, lowered, problems, readBaseline, sizeOrNull } from "./file-size";

const fake = (sizes: Record<string, number>) => (f: string) => sizes[f] ?? null;

describe("the file size ratchet (file-size spec §3)", () => {
  it("the repo keeps every rule", () => {
    expect(problems(countedFiles(), readBaseline(), sizeOrNull)).toEqual([]);
  });

  it("counts sources, tests, mods and architecture docs, and skips the rest", () => {
    const files = countedFiles();
    expect(files).toContain("packages/shell/src/main/index.ts");
    expect(files).toContain("packages/mods/home/test/HarnessApp.test.tsx");
    expect(files).toContain("docs/architecture/tools.md");
    expect(files.some((f) => f.includes("/node_modules/") || f.endsWith(".d.ts") || f.includes("/fixtures/") || f.startsWith("docs/superpowers/"))).toBe(false);
  });

  it("a new file over the cap fails, naming the file, its size and the fix", () => {
    const [p] = problems(["a.ts"], {}, fake({ "a.ts": CAP + 1 }));
    expect(p).toMatch(/^a\.ts is 48\.0 KB, over the 48\.0 KB cap\. Split it/);
  });

  it("a baseline file that grew fails; one that shrank or stayed passes", () => {
    expect(problems(["b.ts"], { "b.ts": 60_000 }, fake({ "b.ts": 60_001 }))[0]).toMatch(/over its baseline/);
    expect(problems(["b.ts"], { "b.ts": 60_000 }, fake({ "b.ts": 60_000 }))).toEqual([]);
    expect(problems(["b.ts"], { "b.ts": 60_000 }, fake({ "b.ts": 55_000 }))).toEqual([]);
  });

  it("a stale entry fails: the file is gone or under the cap", () => {
    expect(problems([], { "gone.ts": 60_000 }, fake({}))[0]).toMatch(/no longer exists\. Run `pnpm size-baseline`/);
    expect(problems(["c.ts"], { "c.ts": 60_000 }, fake({ "c.ts": CAP }))[0]).toMatch(/now under the cap/);
  });

  it("lowering never raises or adds an entry, and drops stale ones", () => {
    const sizes = fake({ "a.ts": 70_000, "b.ts": 50_100, "c.ts": 40_000, "new.ts": 90_000 });
    expect(lowered({ "a.ts": 60_000, "b.ts": 60_000, "c.ts": 60_000, "gone.ts": 60_000 }, sizes)).toEqual({ "a.ts": 60_000, "b.ts": 50_176 });
  });
});
