import fs from "node:fs";
import path from "node:path";
import { layoutSchema, modJsonSchema } from "@humanharness/mod-sdk";
import { describe, expect, it } from "vitest";
import { TEMPLATE_ID } from "../src/template";
import { CORE, read } from "./helpers";

const TEMPLATE = path.join(CORE, "packages", "cli", "template");
const FILES = [
  "harness.config.ts",
  "agent/AGENTS.md",
  "agent/tasks/example.md",
  "ui/App.tsx",
  "mods/example/mod.json",
  "mods/example/ui.tsx",
  "mods/example/README.md",
  "layouts/main.json",
  "ui/harness.css",
  "locales/en.json",
  "README.md",
  "HARNESS.md",
  "tsconfig.json",
  "tools/word-count.ts",
  "tools/word-count/fixtures/basic.json",
  "tools/word-count/fixtures/outside.json",
];

describe("template", () => {
  it("has exactly the minimal harness's files, and no package.json (init writes it)", () => {
    const all = fs.readdirSync(TEMPLATE, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(TEMPLATE, path.join(e.parentPath, e.name)));
    expect(all.sort()).toEqual([...FILES].sort());
  });

  it("has a layout that passes layoutSchema and a mod.json that passes modJsonSchema", () => {
    const layout = layoutSchema.safeParse(JSON.parse(read(TEMPLATE, "layouts/main.json")));
    expect(layout.success, JSON.stringify(layout.error?.issues)).toBe(true);
    const mod = modJsonSchema.safeParse(JSON.parse(read(TEMPLATE, "mods/example/mod.json")));
    expect(mod.success, JSON.stringify(mod.error?.issues)).toBe(true);
    expect(mod.data).toMatchObject({ id: "example", ui: "ui.tsx" });
    expect(mod.data?.main).toBeUndefined();
    expect(read(TEMPLATE, "layouts/main.json")).toContain('"mod": "example"');
  });

  it("declares its mod and has no example_card block", () => {
    const config = read(TEMPLATE, "harness.config.ts");
    expect(config).toContain("mods: { example: {} }");
    for (const file of FILES) expect(read(TEMPLATE, file)).not.toMatch(/example_card|exampleCard|ExampleCard/);
  });

  it("is written with the id init replaces", () => {
    expect(read(TEMPLATE, "harness.config.ts")).toContain(`id: "${TEMPLATE_ID}"`);
    expect(read(TEMPLATE, "HARNESS.md")).toMatch(new RegExp(`^# ${TEMPLATE_ID}\\n`));
  });

  it("has a brief that ends the answer with show_choices and takes the notes index", () => {
    const brief = read(TEMPLATE, "agent/tasks/example.md");
    expect(brief).toMatch(/^# Task: example\n/);
    expect(brief).toContain("show_choices");
    expect(brief).toContain("{{notesIndex}}");
  });

  it("harness.css uses only guide font sizes and weights (style guide §2)", () => {
    const css = fs.readFileSync(path.join(TEMPLATE, "ui", "harness.css"), "utf8");
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect([12, 13, 14, 15, 16, 20, 28]).toContain(Number(m[1]));
    for (const m of css.matchAll(/font-weight:\s*(\d+)/g)) expect([400, 500, 600]).toContain(Number(m[1]));
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
