import { describe, expect, it } from "vitest";
import { whenHolds } from "../../src/main/jobs/when";
import type { StepValues } from "../../src/main/tools/pre-steps";

const v = (entries: Record<string, unknown>): StepValues =>
  new Map(Object.entries(entries).map(([k, value]) => [k, { ok: true as const, value }]));

describe("when (tools spec §7.2)", () => {
  it("no when always holds", () => expect(whenHolds(undefined, v({}))).toBe(true));

  it.each([
    [[1], true],
    [[], false],
    [{ a: 1 }, true],
    [{}, false],
    ["x", true],
    ["", false],
    [0, true],
    [false, true],
    [null, false],
  ])("{ from } on %j is %s", (value, want) => expect(whenHolds({ from: "x" }, v({ x: value }))).toBe(want));

  it("a missing or failed result never holds", () => {
    expect(whenHolds({ from: "x" }, v({}))).toBe(false);
    expect(whenHolds({ from: "x" }, new Map([["x", { ok: false as const, tool: "t" }]]))).toBe(false);
    expect(whenHolds({ from: "x", where: { a: 1 } }, new Map([["x", { ok: false as const, tool: "t" }]]))).toBe(false);
  });

  it("where: an array with one item whose fields equal every value", () => {
    const ci = [
      { failed: false, repo: "a" },
      { failed: true, repo: "b" },
    ];
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci }))).toBe(true);
    expect(whenHolds({ from: "ci", where: { failed: true, repo: "b" } }, v({ ci }))).toBe(true);
    expect(whenHolds({ from: "ci", where: { failed: true, repo: "a" } }, v({ ci }))).toBe(false);
  });

  it("where on an empty array is false", () => {
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci: [] }))).toBe(false);
  });

  it("where on a non-array, or items that aren't objects, is false", () => {
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci: { failed: true } }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci: [true] }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci: [null, [{ failed: true }]] }))).toBe(false);
  });

  it("where compares top-level own fields with ===, never through the prototype", () => {
    expect(whenHolds({ from: "ci", where: { constructor: null } }, v({ ci: [{}] }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { n: 1 } }, v({ ci: [{ n: "1" }] }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { n: null } }, v({ ci: [{}] }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { n: null } }, v({ ci: [{ n: null }] }))).toBe(true);
  });

  it("a __proto__ field in a parsed result is an own field like any other", () => {
    const ci = JSON.parse('[{"__proto__":{"failed":true}}]') as unknown;
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci }))).toBe(false);
  });
});
