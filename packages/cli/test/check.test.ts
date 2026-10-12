import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type CheckResult, checkHarness, findBrand } from "../src/check";
import { initHarness } from "../src/init";
import { CORE, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-check-");
afterAll(cleanup);
let n = 0;

/** A fresh harness repo from the template, changed by `edit`. Each one has its own folder: manifests are imported once. */
async function fixture(edit: (dir: string) => void = () => {}): Promise<string> {
  const dir = path.join(root, `h${++n}`);
  await initHarness({ dir, core: CORE, install: false });
  edit(dir);
  return dir;
}
const errors = (r: CheckResult) => r.findings.filter((f) => f.severity === "error");
const rules = (r: CheckResult) => r.findings.map((f) => `${f.severity}:${f.rule}`);

describe("check: errors", () => {
  it("finds no error in the untouched template", async () => {
    const r = await checkHarness(await fixture());
    expect(errors(r)).toEqual([]);
    expect(r.harness?.id).toBe("h1");
  });

  it("schema: reports each manifest issue with its path", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", 'cost: "light"', 'cost: "low"');
      replaceIn(d, "harness.config.ts", 'core: "^0.1.0"', 'core: ""');
    });
    const r = await checkHarness(dir);
    expect(r.harness).toBeNull();
    const schema = r.findings.filter((f) => f.rule === "schema");
    expect(schema.map((f) => f.message.split(":")[0]).sort()).toEqual(["actions.example.cost", "core"]);
    expect(schema.every((f) => f.severity === "error" && f.file === "harness.config.ts")).toBe(true);
  });

  it("schema: a missing manifest", async () => {
    const dir = await fixture((d) => fs.rmSync(path.join(d, "harness.config.ts")));
    expect(rules(await checkHarness(dir))).toEqual(["error:schema"]);
  });

  it("i18n: a key missing in one language, a missing locale file, a UI key with no string", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "locales/en.json", '"hint": "The AI can be wrong: check what matters.",', "");
      replaceIn(d, "ui/ExampleCard.tsx", '<h3>{data.title}</h3>', '<h3 title={t("cardTitle")}>{data.title}</h3>');
    });
    const r = await checkHarness(dir);
    const i18n = r.findings.filter((f) => f.rule === "i18n").map((f) => `${f.file}${f.line ? `:${f.line}` : ""} ${f.message}`);
    expect(i18n).toEqual([
      'locales/en.json "hint" is missing in en.',
      'ui/ExampleCard.tsx:10 "cardTitle" is used here but missing in es.',
      'ui/ExampleCard.tsx:10 "cardTitle" is used here but missing in en.',
    ]);
    const gone = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "locales", "es.json"))));
    expect(gone.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/es.json is missing: every declared language needs its strings."]);
  });

  it("brief-missing: a missing or empty brief", async () => {
    const missing = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "agent", "tasks", "example.md"))));
    expect(missing.findings.filter((f) => f.rule === "brief-missing").map((f) => f.message)).toEqual(['Action "example": its brief ./agent/tasks/example.md does not exist.']);
    const empty = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "agent", "tasks", "example.md"), " \n")));
    expect(empty.findings.filter((f) => f.rule === "brief-missing").map((f) => f.message)).toEqual(['Action "example": its brief ./agent/tasks/example.md is empty.']);
  });

  it("brand: a provider or model brand in the name, tagline or logo file name", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", `name: { es: "h${n}", en: "h${n}" },`, `name: { es: "Tutor Claude", en: "Tutor" }, tagline: { es: "Con GPT", en: "Plain" }, logo: "./gemini-logo.svg",`);
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brand").map((f) => f.message)).toEqual([
      'The name (es) "Tutor Claude" uses the word "Claude", a provider or model brand in the app name: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.',
      'The tagline (es) "Con GPT" uses the word "GPT", a provider or model brand in the app tagline: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.',
      'The logo file name "gemini-logo.svg" uses the word "Gemini", a provider or model brand in the logo file name: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.',
    ]);
  });

  it("brand: a word that only contains a brand is not one", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", `name: { es: "h${n}", en: "h${n}" },`, `name: { es: "Claudette", en: "Googleplex notes" }, tagline: { es: "Codexes antiguos", en: "Old codexes" }, logo: "./geminid-logo.svg",`);
    });
    expect((await checkHarness(dir)).findings.filter((f) => f.rule === "brand")).toEqual([]);
  });

  it("findBrand matches whole words, without case", () => {
    expect(findBrand("my claude helper")).toBe("Claude");
    expect(findBrand("Built on ChatGPT")).toBe("ChatGPT");
    expect(findBrand("Claudette's kitchen")).toBeNull();
    expect(findBrand("old codexes")).toBeNull();
    expect(findBrand("geminids")).toBeNull();
    expect(findBrand("gemini_logo.svg")).toBe("Gemini");
    expect(findBrand("Recipes")).toBeNull();
  });

  it("engine-not-allowed: an excluded or unknown engine; a pending one only outside development", async () => {
    const dir = await fixture((d) => replaceIn(d, "harness.config.ts", 'engines: ["claude", "codex"]', 'engines: ["claude", "gemini", "kimi", "nope"]'));
    const dev = await checkHarness(dir);
    expect(dev.findings.filter((f) => f.rule === "engine-not-allowed").map((f) => f.message.split(":")[0])).toEqual(["Gemini is excluded", 'Unknown engine "nope". Known']);
    const dist = await checkHarness(dir, { mode: "distribution" });
    expect(dist.findings.filter((f) => f.rule === "engine-not-allowed")).toHaveLength(3);
  });

  it("harness-md-missing: no HARNESS.md, or no Flow table in it", async () => {
    const none = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "HARNESS.md"))));
    expect(rules(none)).toEqual(["error:harness-md-missing"]);
    const noTable = await checkHarness(await fixture((d) => replaceIn(d, "HARNESS.md", "| Action | Tier | Cost | Purpose |", "Actions:")));
    expect(errors(noTable).map((f) => f.rule)).toEqual(["harness-md-missing"]);
  });

  it("harness-md-mismatch: action ids, tiers, the (questions) row, permissions and engines", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "HARNESS.md", "| example | standard | light |", "| example | deep | light |");
      replaceIn(d, "HARNESS.md", "| (questions) | light | – | Free questions |", "| summary | light | light | Sums up |");
      replaceIn(d, "HARNESS.md", "- web: false — no web access is needed.", "- web: true — looks things up.");
      replaceIn(d, "HARNESS.md", "- exec: false — no commands are needed.\n", "");
      replaceIn(d, "HARNESS.md", "- engines: claude, codex", "- engines: claude");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "harness-md-mismatch").map((f) => f.message)).toEqual([
      '"example": the Flow table says tier deep, harness.config.ts says standard.',
      'The Flow table lists "summary", which harness.config.ts doesn\'t declare.',
      "The Flow table has no (questions) row.",
      'Permissions and engines has no "exec:" line.',
      "web: HARNESS.md says true, harness.config.ts says false.",
      "engines: HARNESS.md says claude, harness.config.ts says claude, codex.",
    ]);
    expect(r.findings.filter((f) => f.rule === "harness-md-mismatch").every((f) => f.file === "HARNESS.md" && typeof f.line === "number")).toBe(true);
  });

  it("harness-md-mismatch: an action missing from the table", async () => {
    const r = await checkHarness(await fixture((d) => replaceIn(d, "HARNESS.md", "| example | standard | light | Shows how an action works |\n", "")));
    expect(r.findings.filter((f) => f.rule === "harness-md-mismatch").map((f) => f.message)).toEqual(['Action "example" is missing from the Flow table.']);
  });
});
