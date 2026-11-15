import { describe, expect, it } from "vitest";
import { type ReleaseDeps, release } from "./release";

function fake(over: Partial<ReleaseDeps> = {}) {
  const calls: string[] = [];
  const deps: ReleaseDeps = {
    readVersion: () => "0.2.0",
    writeVersion: (v) => void calls.push(`write ${v}`),
    branch: () => "master",
    isClean: () => true,
    commit: (m) => void calls.push(`commit ${m}`),
    tag: (t) => void calls.push(`tag ${t}`),
    ...over,
  };
  return { deps, calls };
}

describe("release", () => {
  it("writes, commits, tags and prints the command that publishes it", () => {
    const { deps, calls } = fake();
    const out = release("0.3.0", deps);
    expect(calls).toEqual(["write 0.3.0", "commit chore(release): v0.3.0", "tag v0.3.0"]);
    expect(out).toContain("origin master v0.3.0");
  });

  it.each(["", "1.2", "v1.2.3", "1.2.3-beta", "abc"])("refuses %j as a version", (v) => {
    const { deps, calls } = fake();
    expect(() => release(v, deps)).toThrow(/not a version/);
    expect(calls).toEqual([]);
  });

  it("refuses a missing version", () => {
    expect(() => release(undefined, fake().deps)).toThrow(/not a version/);
  });

  it.each(["0.2.0", "0.1.9", "0.0.1"])("refuses %s when the current is 0.2.0", (v) => {
    const { deps, calls } = fake();
    expect(() => release(v, deps)).toThrow(/not greater/);
    expect(calls).toEqual([]);
  });

  it("compares numerically, not as text", () => {
    expect(() => release("0.10.0", fake().deps)).not.toThrow();
  });

  it("refuses a dirty tree", () => {
    const { deps, calls } = fake({ isClean: () => false });
    expect(() => release("0.3.0", deps)).toThrow(/changes/);
    expect(calls).toEqual([]);
  });

  it("refuses a branch other than master", () => {
    const { deps, calls } = fake({ branch: () => "feat/x" });
    expect(() => release("0.3.0", deps)).toThrow(/master/);
    expect(calls).toEqual([]);
  });
});
