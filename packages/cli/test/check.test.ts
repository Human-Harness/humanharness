import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type CheckResult, checkHarness, findBrand, formatFindings } from "../src/check";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { CORE, memoryIo, replaceIn, tempRoot } from "./helpers";

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

  it("schema: instructions or locales pointing outside the harness folder", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", 'instructions: "./agent/AGENTS.md",', 'instructions: "../x.md", locales: "../locales",');
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "schema").map((f) => `${f.file} ${f.message}`)).toEqual([
      'harness.config.ts locales: "../locales": path escapes the harness folder.',
      'harness.config.ts instructions: "../x.md": path escapes the harness folder.',
    ]);
  });

  it("brief-missing: the instructions file does not exist", async () => {
    const r = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "agent", "AGENTS.md"))));
    expect(r.findings.filter((f) => f.rule === "brief-missing").map((f) => `${f.file} ${f.message}`)).toEqual([
      "harness.config.ts The instructions file ./agent/AGENTS.md does not exist.",
    ]);
  });

  it("i18n: a locale file that is JSON but not an object", async () => {
    const r = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "locales", "es.json"), "null\n")));
    expect(r.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/es.json must be a JSON object."]);
  });

  it("i18n: scans the manifest's ui folder; a template-literal key is not a key", async () => {
    const dir = await fixture((d) => {
      fs.renameSync(path.join(d, "ui"), path.join(d, "screens"));
      replaceIn(d, "harness.config.ts", 'author: "Your name",', 'author: "Your name", ui: "./screens",');
      replaceIn(d, "screens/ExampleCard.tsx", "<h3>{data.title}</h3>", "<h3 title={t(`prefix.${data.title}`)}>{t(\"cardTitle\")}</h3>");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "i18n").map((f) => `${f.file} ${f.message}`)).toEqual([
      'screens/ExampleCard.tsx "cardTitle" is used here but missing in es.',
      'screens/ExampleCard.tsx "cardTitle" is used here but missing in en.',
    ]);
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

  it("harness-md-mismatch: a permission line in a shape HARNESS.md can't read quotes the expected format", async () => {
    const r = await checkHarness(await fixture((d) => replaceIn(d, "HARNESS.md", "- edit: none — the template changes no files.", "- edit: none, the template changes no files.")));
    expect(r.findings.filter((f) => f.rule === "harness-md-mismatch").map((f) => f.message)).toEqual([
      'Permissions and engines: "- edit: none, the template changes no files." is not in the expected format `- edit: none — reason`.',
    ]);
  });

  it("harness-md-mismatch: an action missing from the table", async () => {
    const r = await checkHarness(await fixture((d) => replaceIn(d, "HARNESS.md", "| example | standard | light | Shows how an action works |\n", "")));
    expect(r.findings.filter((f) => f.rule === "harness-md-mismatch").map((f) => f.message)).toEqual(['Action "example" is missing from the Flow table.']);
  });
});

describe("check: warnings", () => {
  it("finds nothing at all in the untouched template", async () => {
    expect((await checkHarness(await fixture())).findings).toEqual([]);
  });

  it("pillar-decisions and pillar-flow: no choices, no custom block, one action, no path", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", "blocks: { example_card: exampleCard },", "blocks: {},");
      replaceIn(d, "agent/tasks/example.md", "End with `show_choices`: one option with a `followUp` to go deeper on that idea.", "Stop there.");
      replaceIn(d, "agent/AGENTS.md", "- End every answer with `show_choices`, offering how to continue.\n", "");
    });
    expect(rules(await checkHarness(dir))).toEqual(["warning:pillar-decisions", "warning:pillar-flow"]);
  });

  it("pillar-context: every brief skips the note, or HARNESS.md → Context is empty", async () => {
    const skip = await fixture((d) => replaceIn(d, "agent/tasks/example.md", "{{notesIndex}}", "Never call `save_note`.\n\n{{notesIndex}}"));
    expect(rules(await checkHarness(skip))).toEqual(["warning:pillar-context"]);
    const curly = await fixture((d) => replaceIn(d, "agent/tasks/example.md", "{{notesIndex}}", "Don’t call `save_note`.\n\n{{notesIndex}}"));
    expect(rules(await checkHarness(curly))).toEqual(["warning:pillar-context"]);
    const empty = await fixture((d) => replaceIn(d, "HARNESS.md", "Each closed task saves a note with the core `save_note` fields: a title, up to five summary points, the decisions taken, the files that back them and the questions left open.", "<!-- later -->"));
    const r = await checkHarness(empty);
    expect(r.findings).toMatchObject([{ rule: "pillar-context", severity: "warning", file: "HARNESS.md" }]);
  });

  it("tier-cost: heavy at light, or light at deep", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", 'tier: "standard"', 'tier: "deep"');
      replaceIn(d, "HARNESS.md", "| example | standard | light |", "| example | deep | light |");
    });
    expect((await checkHarness(dir)).findings.map((f) => f.message)).toEqual(['"example" has cost "light" but runs at tier deep: lower the tier or raise the cost hint.']);
  });

  it("permissions-wide: exec, web or edit: folder without a reason line", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", 'permissions: { edit: "none", exec: false, web: false }', 'permissions: { edit: "folder", exec: false, web: true }');
      replaceIn(d, "HARNESS.md", "- edit: none — the template changes no files.", "- edit: folder");
      replaceIn(d, "HARNESS.md", "- web: false — no web access is needed.", "- web: true — compares prices online.");
    });
    expect((await checkHarness(dir)).findings.map((f) => `${f.rule} ${f.message}`)).toEqual(["permissions-wide edit: folder has no reason in HARNESS.md → Permissions and engines."]);
  });

  it("open-questions: the section has content", async () => {
    const dir = await fixture((d) => replaceIn(d, "HARNESS.md", "<!-- Anything still undecided. `check` warns while this section has content. -->", "- Should it plan two weeks at once?"));
    expect(rules(await checkHarness(dir))).toEqual(["warning:open-questions"]);
  });
});

describe("humanharness check", () => {
  it("says so when there is nothing to report, with exit code 0", async () => {
    const m = memoryIo(await fixture());
    expect(await main(["check"], m.io)).toBe(0);
    expect(m.out()).toBe("No problems found.\n");
  });

  it("lists the findings and exits with 1 on errors; --harness points at another folder", async () => {
    const dir = await fixture((d) => replaceIn(d, "HARNESS.md", "- engines: claude, codex", "- engines: claude"));
    const m = memoryIo(root);
    expect(await main(["check", "--harness", dir], m.io)).toBe(1);
    expect(m.out()).toMatch(/^error\s+harness-md-mismatch\s+HARNESS\.md:\d+\s+engines: HARNESS\.md says claude/m);
    expect(m.out()).toContain("1 error, 0 warnings");
  });

  it("--json prints the findings as an array", async () => {
    const dir = await fixture((d) => replaceIn(d, "HARNESS.md", "<!-- Anything still undecided. `check` warns while this section has content. -->", "- Two weeks?"));
    const m = memoryIo(dir);
    expect(await main(["check", "--json"], m.io)).toBe(0);
    expect(JSON.parse(m.out())).toEqual([{ rule: "open-questions", severity: "warning", message: expect.any(String), file: "HARNESS.md", line: expect.any(Number) }]);
  });

  it("formats counts in the singular and plural", () => {
    const f = { rule: "brand" as const, severity: "error" as const, message: "m", file: "harness.config.ts" };
    expect(formatFindings([f, f, { ...f, severity: "warning", rule: "tier-cost" }])).toMatch(/\n2 errors, 1 warning\n$/);
  });
});

describe("mock recordings", () => {
  const good = {
    version: 1,
    action: "example",
    match: "# Task: example",
    turns: [
      { id: "t1", text: "hi", blocks: [{ tool: "show_choices", input: { options: [{ label: "Go deeper", followUp: "More." }] } }], next: { "Go deeper": "t2", "*": "t2" } },
      { id: "t2", text: "more" },
    ],
  };
  const rulesFor = async (files: Record<string, unknown>, brief?: string) => {
    const dir = await fixture((d) => {
      fs.mkdirSync(path.join(d, "mock"));
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(d, "mock", name), typeof content === "string" ? content : JSON.stringify(content));
      if (brief) fs.writeFileSync(path.join(d, "agent", "tasks", "example.md"), brief);
    });
    return (await checkHarness(dir)).findings.filter((f) => f.rule.startsWith("mock-")).map((f) => f.rule);
  };
  const briefWith = "# Task: example\n\nDo it in {{language}}.\n";

  it("a good recording passes, and no mock/ means no finding", async () => {
    expect(await rulesFor({ "example.json": good }, briefWith)).toEqual([]);
    const r = await checkHarness(await fixture());
    expect(r.findings.filter((f) => f.rule.startsWith("mock-"))).toEqual([]);
  });
  it("mock-schema", async () => {
    expect(await rulesFor({ "example.json": "{" })).toEqual(["mock-schema"]);
    expect(await rulesFor({ "example.json": { ...good, version: 2 } })).toEqual(["mock-schema"]);
  });
  it("mock-action", async () => {
    expect(await rulesFor({ "other.json": good }, briefWith)).toEqual(["mock-action"]);
    expect(await rulesFor({ "nope.json": { ...good, action: "nope" } })).toEqual(["mock-action"]);
  });
  it("mock-match", async () => {
    expect(await rulesFor({ "example.json": { ...good, match: "# Something else" } }, briefWith)).toEqual(["mock-match"]);
  });
  it("mock-next", async () => {
    expect(await rulesFor({ "example.json": { ...good, turns: [{ ...good.turns[0], next: { "*": "t9" } }, good.turns[1]] } }, briefWith)).toEqual(["mock-next"]);
    expect(await rulesFor({ "example.json": { ...good, turns: [good.turns[0], good.turns[1], { id: "t2" }] } }, briefWith)).toEqual(["mock-next"]);
  });
  it("mock-choice", async () => {
    expect(await rulesFor({ "example.json": { ...good, turns: [{ ...good.turns[0], next: { "Not offered": "t2" } }, good.turns[1]] } }, briefWith)).toEqual(["mock-choice"]);
  });
  it("the unmodified template brief and a recording of its first line pass", async () => {
    const brief = fs.readFileSync(path.join(CORE, "packages", "cli", "template", "agent", "tasks", "example.md"), "utf8");
    expect(brief.startsWith("# Task: example")).toBe(true);
    expect(await rulesFor({ "example.json": good })).toEqual([]);
  });
  it("mock-schema: a directory named like a recording is not a file", async () => {
    const dir = await fixture((d) => fs.mkdirSync(path.join(d, "mock", "x.json"), { recursive: true }));
    const found = (await checkHarness(dir)).findings.filter((f) => f.rule.startsWith("mock-"));
    expect(found.map((f) => f.rule)).toEqual(["mock-schema"]);
    expect(found[0].message).toContain("not a file");
  });
  describe("a match inside another action's brief", () => {
    const withSecond = async (otherBrief: string, files: Record<string, unknown>) => {
      const dir = await fixture((d) => {
        const cfg = path.join(d, "harness.config.ts");
        fs.writeFileSync(
          cfg,
          fs.readFileSync(cfg, "utf8").replace(
            "  actions: {\n",
            `  actions: {\n    other: { label: { es: "Otro", en: "Other" }, description: { es: "Otro.", en: "Other." }, prompt: "./agent/tasks/other.md", cost: "light", tier: "standard" },\n`,
          ),
        );
        fs.writeFileSync(path.join(d, "agent", "tasks", "other.md"), otherBrief);
        fs.mkdirSync(path.join(d, "mock"));
        for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(d, "mock", name), JSON.stringify(content));
      });
      return (await checkHarness(dir)).findings.filter((f) => f.rule.startsWith("mock-"));
    };
    it("is an error", async () => {
      const found = await withSecond("# Task: example\n\n# Task: other\n", { "example.json": good });
      expect(found.map((f) => f.rule)).toEqual(["mock-match"]);
      expect(found[0].message).toContain('also appears in the brief of "other"');
    });
    it("is fine when the other action has a longer match in its own brief", async () => {
      const other = { ...good, action: "other", match: "# Task: example\n\n# Task: other" };
      expect(await withSecond("# Task: example\n\n# Task: other\n", { "example.json": good, "other.json": other })).toEqual([]);
    });
  });
  it("shows up in --json and formatFindings", async () => {
    const r = await checkHarness(await fixture((d) => {
      fs.mkdirSync(path.join(d, "mock"));
      fs.writeFileSync(path.join(d, "mock", "example.json"), "{");
    }));
    expect(JSON.parse(JSON.stringify(r)).findings.some((f: { rule: string; file: string }) => f.rule === "mock-schema" && f.file === "mock/example.json")).toBe(true);
    expect(formatFindings(r.findings)).toContain("mock-schema");
  });
});
