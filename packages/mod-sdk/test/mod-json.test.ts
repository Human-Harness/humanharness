import { describe, expect, it } from "vitest";
import { MOD_API_VERSION, modJsonSchema } from "../src/mod-json";

const ok = { id: "echo", name: "Echo", version: "0.1.0", apiVersion: MOD_API_VERSION };

describe("mod.json", () => {
  it("accepts the minimal file and defaults the rest", () => {
    expect(modJsonSchema.parse(ok)).toEqual({ ...ok, requires: [], history: false });
  });
  it("main and ui are optional: a mod may have neither", () => {
    const m = modJsonSchema.parse(ok);
    expect(m.main).toBeUndefined();
    expect(m.ui).toBeUndefined();
    expect(modJsonSchema.parse({ ...ok, main: "main.js", ui: "ui.js" })).toMatchObject({ main: "main.js", ui: "ui.js" });
  });
  it("refuses a bad id, an unknown API version and unknown keys", () => {
    expect(modJsonSchema.safeParse({ ...ok, id: "Echo!" }).success).toBe(false);
    expect(modJsonSchema.safeParse({ ...ok, apiVersion: 99 }).success).toBe(false);
    expect(modJsonSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it("refuses a main outside the mod's folder", () => {
    expect(modJsonSchema.safeParse({ ...ok, main: "../x.js" }).success).toBe(false);
    expect(modJsonSchema.safeParse({ ...ok, main: "/abs/x.js" }).success).toBe(false);
  });
  it("refuses a ui outside the mod's folder, with the same message as main", () => {
    const r = modJsonSchema.safeParse({ ...ok, ui: "../x.js" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain("inside the mod's folder");
    expect(r.error?.issues[0].path).toEqual(["ui"]);
  });
  it("refuses requiring itself", () => {
    expect(modJsonSchema.safeParse({ ...ok, requires: ["echo"] }).success).toBe(false);
  });
});
