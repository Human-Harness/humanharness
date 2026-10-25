import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATE_ID } from "../src/template";
import { CORE, read } from "./helpers";

const TEMPLATE = path.join(CORE, "packages", "cli", "template");
const FILES = [
  "harness.config.ts",
  "agent/AGENTS.md",
  "agent/tasks/example.md",
  "ui/App.tsx",
  "ui/ExampleCard.tsx",
  "ui/harness.css",
  "locales/en.json",
  "README.md",
  "HARNESS.md",
  "tsconfig.json",
];

describe("template", () => {
  it("has exactly the minimal harness's files, and no package.json (init writes it)", () => {
    const all = fs.readdirSync(TEMPLATE, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(TEMPLATE, path.join(e.parentPath, e.name)));
    expect(all.sort()).toEqual([...FILES].sort());
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
});
