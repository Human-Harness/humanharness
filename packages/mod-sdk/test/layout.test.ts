import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { layoutSchema } from "../src/layout";

const defaultLayout = JSON.parse(readFileSync(path.resolve(__dirname, "../../shell/src/main/mods/default-layout.json"), "utf8"));
const task = { type: "block", id: "work", content: { core: "task" } };
const home = { type: "block", id: "home", content: { mod: "home", block: "home" } };
const stack = (...children: unknown[]) => ({ type: "stack", children });
const messages = (v: unknown): string[] => {
  const r = layoutSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("layoutSchema", () => {
  it("parses the core's default layout", () => {
    expect(layoutSchema.safeParse(defaultLayout).success).toBe(true);
  });
  it("takes sizes, header, hidden and nested rows", () => {
    const l = stack(home, { type: "stack", id: "work", header: { mod: "x", block: "h", props: { a: 1 } }, min: 10, max: 50, size: { weight: 2 }, children: [{ type: "row", hidden: true, size: { px: 30 }, children: [{ type: "block", content: { core: "task" } }] }] });
    expect(messages(l)).toEqual([]);
  });
  it("refuses a root that is not a stack", () => {
    expect(messages({ type: "row", children: [home, task] })).toContain("The root must be a stack");
  });
  it("refuses a missing home and a missing work", () => {
    expect(messages(stack({ ...home, id: "h" }, task))).toContain('The root must have a child with id "home"');
    expect(messages(stack(home, { ...task, id: "w" }))).toContain('The root must have a child with id "work"');
  });
  it("refuses no task block, two, and one outside work", () => {
    expect(messages(stack(home, { type: "block", id: "work", content: { mod: "a", block: "b" } }))).toContain('The layout must have exactly one { "core": "task" } block, it has 0');
    expect(messages(stack(home, task, { type: "block", content: { core: "task" } }))).toContain('The layout must have exactly one { "core": "task" } block, it has 2');
    expect(messages(stack({ type: "block", id: "home", content: { core: "task" } }, { type: "block", id: "work", content: { mod: "a", block: "b" } }))).toContain('The { "core": "task" } block must be inside the "work" child');
  });
  it("refuses duplicate ids", () => {
    expect(messages(stack(home, task, { type: "block", id: "home", content: { mod: "a", block: "b" } }))).toContain('The id "home" is used 2 times: ids must be unique');
  });
  it("refuses more than 8 levels", () => {
    let inner: unknown = { type: "block", content: { mod: "a", block: "b" } };
    for (let i = 0; i < 7; i++) inner = { type: "row", children: [inner] };
    expect(messages(stack(home, task, inner))).toContain("The layout is 9 levels deep: at most 8");
  });
  it("refuses more than 64 nodes", () => {
    const many = Array.from({ length: 63 }, () => ({ type: "block", content: { mod: "a", block: "b" } }));
    expect(messages(stack(home, task, ...many))).toContain("The layout has 66 nodes: at most 64");
  });
  it("refuses an unknown node type and an extra key", () => {
    expect(layoutSchema.safeParse(stack(home, task, { type: "grid", children: [] })).success).toBe(false);
    expect(layoutSchema.safeParse(stack(home, { ...task, extra: 1 })).success).toBe(false);
    expect(layoutSchema.safeParse({ type: "stack", extra: 1, children: [home, task] }).success).toBe(false);
  });
});
