import { describe, expect, it } from "vitest";
import { parseToml } from "../../src/main/engine-config/toml-lite";

describe("parseToml (Decision 4)", () => {
  it("keys, strings, numbers, booleans", () => {
    expect(parseToml("a = \"x\"\nb = 3\nc = 1.5\nd = true\ne = 'lit\\n'")).toEqual({ a: "x", b: 3, c: 1.5, d: true, e: "lit\\n" });
  });
  it("basic string escapes", () => {
    expect(parseToml('a = "q\\"t\\n\\u00e9"')).toEqual({ a: 'q"t\né' });
  });
  it("tables and dotted keys", () => {
    expect(parseToml("[features]\nx = true\n[tools]\nweb_search = false\nsandbox_workspace_write.network_access = true")).toEqual({
      features: { x: true },
      tools: { web_search: false, sandbox_workspace_write: { network_access: true } },
    });
  });
  it("arrays (multi-line too) and inline tables", () => {
    expect(parseToml('a = [1, 2,\n 3]\nb = { c = "d", e = [true] }')).toEqual({ a: [1, 2, 3], b: { c: "d", e: [true] } });
  });
  it("arrays of tables", () => {
    expect(parseToml('[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse]]\nmatcher = "Edit"')).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash" }, { matcher: "Edit" }] },
    });
  });
  it("comments and blank lines", () => {
    expect(parseToml('# c\n\na = 1 # trailing\nb = "# not a comment"')).toEqual({ a: 1, b: "# not a comment" });
  });
  it.each([
    ["a = 1\na = 2", "line 2: a is defined twice"],
    ["a = 1979-05-27", "line 1: dates are not supported"],
    ['a = """x"""', "line 1: multi-line strings are not supported"],
    ["a =", "line 1"],
    ["[a\nb = 1", "line 1"],
    ["__proto__ = 1", "line 1: __proto__"],
    ['"constructor".x = 1', "line 1: constructor"],
  ])("refuses %j naming the line", (src, message) => {
    expect(() => parseToml(src)).toThrow(message);
  });
  it.each([
    ["[a]\nx = 1\n[a]", "line 3: a is defined twice"],
    ["a = { b = 1 }\na.c = 2", "line 2: a is defined twice"],
    ["a = [1]\n[[a]]", "line 2: a is defined twice"],
    ['a = "open', "line 1: the string is not closed"],
    ["a = 0x1F", "line 1"],
    ["a = 1 b = 2", "line 1: unexpected text"],
    ["a = [1,\n2 3]", "line 2"],
  ])("refuses %j (redefinitions and bad syntax)", (src, message) => {
    expect(() => parseToml(src)).toThrow(message);
  });
  it("reads CRLF line ends and a table under an array of tables", () => {
    expect(parseToml("[[s]]\r\nn = 1\r\n[s.t]\r\nm = 2\r\n")).toEqual({ s: [{ n: 1, t: { m: 2 } }] });
  });
  it("builds plain objects with no prototype pollution", () => {
    const out = parseToml("[a]\nb = 1") as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).b).toBeUndefined();
  });
  it("refuses input over 256 KB", () => {
    expect(() => parseToml("a = 1\n".repeat(50_000))).toThrow("too large");
  });
});
