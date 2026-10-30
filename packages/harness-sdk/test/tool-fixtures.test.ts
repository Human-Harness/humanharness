import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolFixtureSchema } from "../src/tool-fixtures";

const FETCH = { kind: "fetch", request: { method: "GET", url: "https://api.example.com/q" }, response: { status: 200, headers: {}, text: "ok" } };
const ok = (raw: unknown) => toolFixtureSchema.safeParse(raw).success;

describe("toolFixtureSchema (tools spec §11, Decision 1)", () => {
  it("takes args, inputs, scope, exchanges, data, files and expect.result", () => {
    const full = toolFixtureSchema.parse({
      args: { q: "x" },
      inputs: { lookup: { n: 1 } },
      scope: "acme",
      exchanges: [FETCH],
      data: { notes: [{ id: "a", text: "hi" }] },
      files: { "notes/today.md": "# Today", "a.txt": "" },
      expect: { result: { count: 1 } },
    });
    expect(full).toEqual({
      args: { q: "x" },
      inputs: { lookup: { n: 1 } },
      scope: "acme",
      exchanges: [FETCH],
      data: { notes: [{ id: "a", text: "hi" }] },
      files: { "notes/today.md": "# Today", "a.txt": "" },
      expect: { result: { count: 1 } },
    });
    // args defaults to {}, scope to null; the rest stay absent.
    expect(toolFixtureSchema.parse({ expect: { result: 1 } })).toEqual({ args: {}, scope: null, expect: { result: 1 } });
    // The app-wide scope and a scope name that starts with a digit are scopes too.
    expect(toolFixtureSchema.parse({ scope: "_app", expect: { result: 1 } }).scope).toBe("_app");
    expect(toolFixtureSchema.parse({ scope: "2026-q1", expect: { result: 1 } }).scope).toBe("2026-q1");
    expect(ok({ scope: "Bad Scope", expect: { result: 1 } })).toBe(false);
  });

  it("a result of null, and an explicit result: undefined, are result cases; a missing result key is not", () => {
    expect(toolFixtureSchema.parse({ expect: { result: null } }).expect).toEqual({ result: null });
    const undef = toolFixtureSchema.parse({ expect: { result: undefined } }).expect;
    expect("result" in undef).toBe(true);
    expect(ok({ expect: {} })).toBe(false);
  });

  it("takes expect.error instead of expect.result", () => {
    expect(toolFixtureSchema.parse({ args: { q: "" }, expect: { error: "q is empty" } }).expect).toEqual({ error: "q is empty" });
    expect(ok({ expect: { error: "" } })).toBe(false);
    expect(ok({ expect: { error: "x".repeat(501) } })).toBe(false);
  });

  it("refuses both or neither of result and error", () => {
    expect(ok({ expect: { result: 1, error: "x" } })).toBe(false);
    expect(ok({ expect: {} })).toBe(false);
    expect(ok({ args: {} })).toBe(false);
  });

  it("refuses an unknown key (strict)", () => {
    expect(ok({ expect: { result: 1 }, extra: true })).toBe(false);
    expect(ok({ expect: { result: 1, note: "x" } })).toBe(false);
  });

  it("refuses a files path outside the folder (absolute, .., .harness/, .git/)", () => {
    const file = (p: string) => ok({ files: { [p]: "x" }, expect: { result: 1 } });
    expect(file("a/b.md")).toBe(true);
    expect(file("docs/.harness-notes.md")).toBe(true);
    for (const bad of ["/etc/passwd", "\\x", "C:/x", "c:x", "../x", "a/../../x", "a\\..\\x", ".harness/notes/a.md", ".harness", ".git/config", ".git", ".harness\\x", ""]) expect(file(bad), bad).toBe(false);
    // Every depth, any case, `.` parts dropped, NUL and backslash refused; a path must name a file.
    for (const bad of ["./.harness/x", ".HARNESS/x", ".Git/config", "a/.git/x", "a/.Harness", "a/./../x", "a\0b", ".", "./", "a/", "//", "a\\b"]) expect(file(bad), bad).toBe(false);
    expect(file("./a/b.md")).toBe(true);
    expect(file("a//b.md")).toBe(true);
    // `__proto__` as a JSON key: an own key after JSON.parse, refused rather than turned into a prototype.
    expect(ok(JSON.parse('{"files":{"__proto__":"x"},"expect":{"result":1}}'))).toBe(false);
    expect(ok({ files: { "a.md": "x".repeat(1024 * 1024 + 1) }, expect: { result: 1 } })).toBe(false);
  });

  it("refuses a data collection name that isn't an id, and __proto__", () => {
    expect(ok({ data: { notes: [] }, expect: { result: 1 } })).toBe(true);
    expect(ok({ data: { "Not An Id": [] }, expect: { result: 1 } })).toBe(false);
    expect(ok({ data: { notes: ["not a record"] }, expect: { result: 1 } })).toBe(false);
    expect(ok(JSON.parse('{"data":{"__proto__":[]},"expect":{"result":1}}'))).toBe(false);
    expect(ok(JSON.parse('{"args":{"__proto__":{"x":1}},"expect":{"result":1}}'))).toBe(false);
    expect(ok(JSON.parse('{"data":{"notes":[{"__proto__":{"x":1}}]},"expect":{"result":1}}'))).toBe(false);
    expect(ok(JSON.parse('{"inputs":{"__proto__":1},"expect":{"result":1}}'))).toBe(false);
  });

  it("refuses an input name that isn't a tool id", () => {
    expect(ok({ inputs: { "Bad Name": 1 }, expect: { result: 1 } })).toBe(false);
  });

  it("exchanges use the plugin fixture exchange schema", () => {
    expect(ok({ exchanges: [FETCH, { kind: "exec", request: { cmd: "git", args: ["log"] }, response: { code: 0, stdout: "", stderr: "" } }], expect: { result: 1 } })).toBe(true);
    expect(ok({ exchanges: [{ ...FETCH, request: { method: "get", url: "https://x" } }], expect: { result: 1 } })).toBe(false);
    expect(ok({ exchanges: [{ ...FETCH, extra: 1 }], expect: { result: 1 } })).toBe(false);
  });

  it("is Node-free (screens and bundles may import it)", () => {
    const src = readFileSync(new URL("../src/tool-fixtures.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "node:|from "\.\/plugin-fixtures"|from "\.\/index"/);
    const schema = readFileSync(new URL("../src/plugin-fixture-schema.ts", import.meta.url), "utf8");
    expect(schema).not.toMatch(/from "node:/);
  });
});
