import { describe, expect, it } from "vitest";
import { GitIgnore } from "../src";

describe("GitIgnore (§8.1)", () => {
  const g = new GitIgnore();
  g.add("", "node_modules/\n*.log\n/build\n!keep.log\n");
  g.add("sub", "secret/\n*.tmp\n");

  it("applies the root file at any depth, folder patterns to folders only", () => {
    expect(g.ignored("node_modules", true)).toBe(true);
    expect(g.ignored("a/node_modules", true)).toBe(true);
    expect(g.ignored("node_modules", false)).toBe(false);
    expect(g.ignored("x.log", false)).toBe(true);
    expect(g.ignored("deep/x.log", false)).toBe(true);
  });

  it("keeps a negation inside its file and an anchored pattern at its root", () => {
    expect(g.ignored("keep.log", false)).toBe(false);
    expect(g.ignored("build", true)).toBe(true);
    expect(g.ignored("src/build", true)).toBe(false);
  });

  it("applies a nested file only below its folder", () => {
    expect(g.ignored("sub/secret", true)).toBe(true);
    expect(g.ignored("other/secret", true)).toBe(false);
    expect(g.ignored("sub/a/b.tmp", false)).toBe(true);
    expect(g.ignored("b.tmp", false)).toBe(false);
  });

  it("is empty until a file is added", () => {
    expect(new GitIgnore().empty).toBe(true);
    expect(g.empty).toBe(false);
  });
});
