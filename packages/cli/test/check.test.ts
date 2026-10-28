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

  it("i18n: a missing en.json", async () => {
    const gone = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "locales", "en.json"))));
    expect(gone.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/en.json is missing: the harness's strings are English."]);
  });

  it("i18n: an en.json that is not valid JSON", async () => {
    const r = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "locales", "en.json"), "{")));
    expect(r.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/en.json is not valid JSON."]);
  });

  it("i18n: another language's file is ignored with a warning", async () => {
    const r = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "locales", "es.json"), "{}\n")));
    const f = r.findings.filter((x) => x.rule === "i18n");
    expect(f.map((x) => [x.severity, x.message])).toEqual([["warning", "locales/es.json is not read: the app translates from en.json."]]);
  });

  it("brief-missing: a missing or empty brief", async () => {
    const missing = await checkHarness(await fixture((d) => fs.rmSync(path.join(d, "agent", "tasks", "example.md"))));
    expect(missing.findings.filter((f) => f.rule === "brief-missing").map((f) => f.message)).toEqual(['Action "example": its brief ./agent/tasks/example.md does not exist.']);
    const empty = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "agent", "tasks", "example.md"), " \n")));
    expect(empty.findings.filter((f) => f.rule === "brief-missing").map((f) => f.message)).toEqual(['Action "example": its brief ./agent/tasks/example.md is empty.']);
  });

  it("brief-missing: a mode's brief that is missing or empty (task-modes spec §3); D0: the template has no modes", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", 'cost: "light",', 'cost: "light",\n      modes: ["plain", "empty", "gone"],');
      replaceIn(
        d,
        "harness.config.ts",
        'questions: { tier: "light" },',
        'questions: { tier: "light" },\n  modes: {\n    plain: { label: "Plain", brief: "./agent/modes/plain.md" },\n    empty: { label: "Empty", brief: "./agent/modes/empty.md" },\n    gone: { label: "Gone", brief: "./agent/modes/gone.md" },\n  },',
      );
      fs.mkdirSync(path.join(d, "agent", "modes"));
      fs.writeFileSync(path.join(d, "agent", "modes", "plain.md"), "Work plainly, in {{language}}.\n");
      fs.writeFileSync(path.join(d, "agent", "modes", "empty.md"), " \n");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brief-missing").map((f) => `${f.file} ${f.message}`)).toEqual([
      'agent/modes/empty.md Mode "empty": its brief ./agent/modes/empty.md is empty.',
      'harness.config.ts Mode "gone": its brief ./agent/modes/gone.md does not exist.',
    ]);
    expect(errors(r).filter((f) => f.rule !== "brief-missing")).toEqual([]);
  });

  it("brief-missing: a phase's brief that is missing or empty (task-phases spec §3); a phase without one is fine", async () => {
    const dir = await fixture((d) => {
      replaceIn(
        d,
        "harness.config.ts",
        'cost: "light",',
        'cost: "light",\n      phases: [\n        { id: "warmup", label: "Warm-up", brief: "./agent/phases/warmup.md" },\n        { id: "main", label: "Main", brief: "./agent/phases/empty.md" },\n        { id: "extra", label: "Extra", brief: "./agent/phases/gone.md" },\n        { id: "close", label: "Close", close: true },\n      ],',
      );
      fs.mkdirSync(path.join(d, "agent", "phases"));
      fs.writeFileSync(path.join(d, "agent", "phases", "warmup.md"), "Two recall questions.\n");
      fs.writeFileSync(path.join(d, "agent", "phases", "empty.md"), " \n");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brief-missing").map((f) => `${f.file} ${f.message}`)).toEqual([
      'agent/phases/empty.md Action "example", phase "main": its brief ./agent/phases/empty.md is empty.',
      'harness.config.ts Action "example", phase "extra": its brief ./agent/phases/gone.md does not exist.',
    ]);
    expect(errors(r).filter((f) => f.rule !== "brief-missing")).toEqual([]);
  });

  it("brief-missing: a job's brief that is missing or empty (parallel spec §3)", async () => {
    const dir = await fixture((d) => {
      replaceIn(
        d,
        "harness.config.ts",
        'questions: { tier: "light" },',
        'questions: { tier: "light" },\n  jobs: {\n    sync: { label: "Sync", prompt: "./agent/jobs/sync.md", on: { manual: true } },\n    tidy: { label: "Tidy", prompt: "./agent/jobs/empty.md", on: { start: true } },\n    gone: { label: "Gone", prompt: "./agent/jobs/gone.md", on: { manual: true } },\n  },',
      );
      fs.mkdirSync(path.join(d, "agent", "jobs"));
      fs.writeFileSync(path.join(d, "agent", "jobs", "sync.md"), "Sync the tickets.\n");
      fs.writeFileSync(path.join(d, "agent", "jobs", "empty.md"), " \n");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brief-missing").map((f) => `${f.file} ${f.message}`)).toEqual([
      'agent/jobs/empty.md Job "tidy": its brief ./agent/jobs/empty.md is empty.',
      'harness.config.ts Job "gone": its brief ./agent/jobs/gone.md does not exist.',
    ]);
    expect(errors(r).filter((f) => f.rule !== "brief-missing")).toEqual([]);
  });

  it("job-daily-tokens: dailyTokens on a job with no every is a warning (it caps nothing)", async () => {
    const dir = await fixture((d) => {
      replaceIn(
        d,
        "harness.config.ts",
        'questions: { tier: "light" },',
        'questions: { tier: "light" },\n  jobs: {\n    sync: { label: "Sync", prompt: "./agent/tasks/example.md", on: { manual: true }, dailyTokens: 1000 },\n    poll: { label: "Poll", prompt: "./agent/tasks/example.md", on: { every: "30m" }, dailyTokens: 1000 },\n  },',
      );
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "job-daily-tokens").map((f) => `${f.severity} ${f.file} ${f.message}`)).toEqual([
      'warning harness.config.ts Job "sync": dailyTokens caps only periodic runs and the job has no every, so it caps nothing.',
    ]);
    expect(errors(r)).toEqual([]);
  });

  it("schema: a job that widens the harness's permissions (J2) or breaks a jobs check", async () => {
    const dir = await fixture((d) => {
      replaceIn(
        d,
        "harness.config.ts",
        'questions: { tier: "light" },',
        'questions: { tier: "light" },\n  jobs: {\n    wide: { label: "Wide", prompt: "./agent/tasks/example.md", on: { manual: true }, permissions: { exec: true } },\n    often: { label: "Often", prompt: "./agent/tasks/example.md", on: { every: "5m" }, dailyTokens: 1000 },\n  },',
      );
    });
    const r = await checkHarness(dir);
    expect(r.harness).toBeNull();
    expect(r.findings.filter((f) => f.rule === "schema").map((f) => f.message)).toEqual([
      "jobs.wide.permissions: A job's permissions can only narrow the harness's",
      'jobs.often.on.every: every must be a duration of 15m or more ("30m", "2h")',
    ]);
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

  it("i18n: en.json that is JSON but not an object", async () => {
    const r = await checkHarness(await fixture((d) => fs.writeFileSync(path.join(d, "locales", "en.json"), "null\n")));
    expect(r.findings.filter((f) => f.rule === "i18n").map((f) => f.message)).toEqual(["locales/en.json must be a JSON object."]);
  });

  it("i18n: scans the manifest's ui folder; a template-literal key is not a key", async () => {
    const dir = await fixture((d) => {
      fs.renameSync(path.join(d, "ui"), path.join(d, "screens"));
      replaceIn(d, "harness.config.ts", 'author: "Your name",', 'author: "Your name", ui: "./screens",');
      replaceIn(d, "screens/ExampleCard.tsx", "<h3>{data.title}</h3>", "<h3 title={t(`prefix.${data.title}`)}>{t(\"cardTitle\")}</h3>");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "i18n").map((f) => `${f.file} ${f.message}`)).toEqual([
      'screens/ExampleCard.tsx "cardTitle" is used here but missing in en.',
    ]);
  });

  it("brand: a provider or model brand in the name, tagline or logo file name", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", `name: "h${n}",`, `name: "Tutor Claude", tagline: "Con GPT", logo: "./gemini-logo.svg",`);
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brand").map((f) => f.message)).toEqual([
      'The name "Tutor Claude" uses the word "Claude", a provider or model brand in the app name: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.',
      'The tagline "Con GPT" uses the word "GPT", a provider or model brand in the app tagline: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.',
      'The logo file name "gemini-logo.svg" uses the word "Gemini", a provider or model brand in the logo file name: the app would look made or endorsed by that provider. Use no provider or model brands in names, taglines or logos.',
    ]);
  });

  it("brand: a word that only contains a brand is not one", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", `name: "h${n}",`, `name: "Claudette", tagline: "Codexes antiguos", logo: "./geminid-logo.svg",`);
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

describe("check: scopes and data", () => {
  it("schema: a data collection with no key, and an action scope without scopes", async () => {
    const data = await checkHarness(
      await fixture((d) =>
        replaceIn(d, "harness.config.ts", '  questions: { tier: "light" },', '  questions: { tier: "light" },\n  data: { cards: { scoped: false, schema: z.object({ front: z.string() }), agent: "write" } },'),
      ),
    );
    expect(data.findings.filter((f) => f.rule === "schema").map((f) => f.message.split(":")[0])).toEqual(["data.cards.key"]);
    const scope = await checkHarness(await fixture((d) => replaceIn(d, "harness.config.ts", 'cost: "light"', 'cost: "light", scope: "none"')));
    expect(scope.findings.filter((f) => f.rule === "schema").map((f) => f.message.split(":")[0])).toEqual(["actions.example.scope"]);
  });

  it("finds no error in a template with scopes and data (D2: both optional)", async () => {
    const r = await checkHarness(
      await fixture((d) =>
        replaceIn(
          d,
          "harness.config.ts",
          '  questions: { tier: "light" },',
          '  questions: { tier: "light" },\n  scopes: { label: "topic", plural: "topics" },\n  data: { cards: { scoped: true, key: "id", schema: z.object({ id: z.string() }), agent: "read" } },',
        ),
      ),
    );
    expect(errors(r)).toEqual([]);
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

  it("material: a light review tier, and app-wide items in a harness with scopes (D0: none without material)", async () => {
    const withMaterial = (scoped: boolean, tiers: string, scopes = true) => (d: string) =>
      replaceIn(
        d,
        "harness.config.ts",
        '  questions: { tier: "light" },',
        `  questions: { tier: "light" },\n${scopes ? '  scopes: { label: "topic", plural: "topics" },\n' : ""}  data: { concepts: { scoped: ${scoped}, key: "id", schema: z.object({ id: z.string(), name: z.string() }), agent: "read" } },\n  material: { sheet: { sections: [{ id: "terms", label: "Terms", prompt: "The key terms." }] }, items: { collection: "concepts", label: "name" }${tiers} },`,
      );
    const material = (r: CheckResult) => r.findings.filter((f) => f.rule.startsWith("material-")).map((f) => `${f.severity}:${f.rule}`);
    const clean = await checkHarness(await fixture(withMaterial(true, "")));
    expect(errors(clean)).toEqual([]);
    expect(material(clean)).toEqual([]);
    expect(material(await checkHarness(await fixture(withMaterial(true, ', tiers: { review: "light" }'))))).toEqual(["warning:material-review-tier"]);
    expect(material(await checkHarness(await fixture(withMaterial(false, ""))))).toEqual(["warning:material-items-scope"]);
    // Without scopes every collection is app-wide: nothing to warn about.
    const unscoped = await checkHarness(await fixture(withMaterial(false, "", false)));
    expect(errors(unscoped)).toEqual([]);
    expect(material(unscoped)).toEqual([]);
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
            `  actions: {\n    other: { label: "Other", description: "Other.", prompt: "./agent/tasks/other.md", cost: "light", tier: "standard" },\n`,
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

describe("check: input blocks", () => {
  const EXAMPLE = 'example: { title: "One idea", body: "A short explanation of why it matters." },';
  const withInput = (input: string) => (d: string) => replaceIn(d, "harness.config.ts", EXAMPLE, `input: ${input},\n  ${EXAMPLE}`);
  const inputRules = (r: CheckResult) => r.findings.filter((f) => f.rule.startsWith("input-")).map((f) => `${f.severity}:${f.rule}`);

  it("an input the core form draws gives no warning", async () => {
    expect(inputRules(await checkHarness(await fixture(withInput("z.object({ why: z.string().min(1) })"))))).toEqual([]);
  });

  it("input-hidden: a block that asks for an answer can't be hidden", async () => {
    const dir = await fixture((d) => {
      withInput("z.object({ why: z.string() })")(d);
      replaceIn(d, "harness.config.ts", "visible: true,", "visible: false,");
    });
    expect(inputRules(await checkHarness(dir))).toEqual(["warning:input-hidden"]);
  });

  it("input-form: a field the core form can't draw needs the block's own component", async () => {
    const deep = withInput("z.object({ deep: z.object({ x: z.string() }) })");
    // The template's ui/App.tsx registers `example_card`: no warning.
    expect(inputRules(await checkHarness(await fixture(deep)))).toEqual([]);
    const bare = await fixture((d) => {
      deep(d);
      replaceIn(d, "ui/App.tsx", "const blocks = { example_card: ExampleCard };", "const blocks = {};");
    });
    const r = await checkHarness(bare);
    expect(inputRules(r)).toEqual(["warning:input-form"]);
    expect(r.findings.find((f) => f.rule === "input-form")?.message).toBe(
      'Block "example_card": the core form can\'t draw "deep". Register a component for it in ui/ (blocks: { example_card: … }).',
    );
  });

  it("input-choice: a choice with no options source, or an optionsFrom that names no string list", async () => {
    const messages = async (input: string) =>
      (await checkHarness(await fixture(withInput(input)))).findings.filter((f) => f.rule === "input-choice").map((f) => `${f.severity} ${f.message}`);
    expect(await messages('z.object({ pick: z.string() }),\n  inputUi: { pick: { kind: "choice" } }')).toEqual([
      'warning Block "example_card": "pick" is a choice with no options: set inputUi.pick.optionsFrom to a string-list field of the shown data. The form draws it as text.',
    ]);
    expect(await messages('z.object({ pick: z.string() }),\n  inputUi: { pick: { optionsFrom: "title" } }')).toEqual([
      'warning Block "example_card": inputUi.pick.optionsFrom is "title", which is not a string-list field of the shown data. The form draws "pick" as text.',
    ]);
    expect(await messages('z.object({ pick: z.string() }),\n  inputUi: { pick: { kind: "choice", optionsFrom: "nope" } }')).toEqual([
      'warning Block "example_card": inputUi.pick.optionsFrom is "nope", which is not a string-list field of the shown data. The form draws "pick" as text.',
    ]);
  });

  it("input-choice: optionsFrom naming a string list of the shown data is fine", async () => {
    const dir = await fixture((d) => {
      withInput('z.object({ pick: z.string() }),\n  inputUi: { pick: { optionsFrom: "options" } }')(d);
      replaceIn(d, "harness.config.ts", "body: z.string().min(1).max(400) })", "body: z.string().min(1).max(400), options: z.array(z.string()).optional() })");
    });
    expect(inputRules(await checkHarness(dir))).toEqual([]);
  });

  it("input-choice: optionsFrom naming a list of string enums, and the choice + options convention, are fine", async () => {
    const shownWith = (options: string, input: string) =>
      fixture((d) => {
        withInput(input)(d);
        replaceIn(d, "harness.config.ts", "body: z.string().min(1).max(400) })", `body: z.string().min(1).max(400), options: ${options} })`);
      });
    const enums = await shownWith('z.array(z.enum(["a", "b"])).optional()', 'z.object({ pick: z.string() }),\n  inputUi: { pick: { optionsFrom: "options" } }');
    expect(inputRules(await checkHarness(enums))).toEqual([]);
    const convention = await shownWith("z.array(z.string()).optional()", "z.object({ choice: z.string() })");
    expect(inputRules(await checkHarness(convention))).toEqual([]);
  });

  it("input-choice: inputUi.kind on a field that isn't a string says it is ignored", async () => {
    const found = (await checkHarness(await fixture(withInput('z.object({ count: z.number() }),\n  inputUi: { count: { kind: "choice" } }'))))
      .findings.filter((f) => f.rule === "input-choice")
      .map((f) => f.message);
    expect(found).toEqual([
      'Block "example_card": inputUi.count.kind "choice" is ignored: only a z.string() field can be text, longText or a choice, and "count" is drawn from its type.',
    ]);
  });
});

describe("check: recorded answers", () => {
  const EXAMPLE = 'example: { title: "One idea", body: "A short explanation of why it matters." },';
  const card = { tool: "show_example_card", input: { title: "T", body: "B" } };
  const rec = (turn1: Record<string, unknown>) => ({ version: 1, action: "example", match: "# Task: example", turns: [{ id: "t1", text: "hi", ...turn1 }, { id: "t2", text: "ok" }] });
  const mockRules = async (recording: object) => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", EXAMPLE, `input: z.object({ why: z.string().min(1) }),\n  ${EXAMPLE}`);
      fs.mkdirSync(path.join(d, "mock"));
      fs.writeFileSync(path.join(d, "mock", "example.json"), JSON.stringify(recording));
    });
    return (await checkHarness(dir)).findings.filter((f) => f.rule.startsWith("mock-")).map((f) => `${f.rule}: ${f.message}`);
  };

  it("a recorded answer to an input block the turn shows passes", async () => {
    expect(await mockRules(rec({ blocks: [card], respond: [{ block: "example_card", value: { why: "because" }, next: "t2" }] }))).toEqual([]);
  });

  it("mock-input: not an input block, not shown in that turn, or not a valid answer; mock-next: no such turn", async () => {
    expect(await mockRules(rec({ blocks: [card], respond: [{ block: "choices", value: {}, next: "t2" }] }))).toEqual([
      'mock-input: Turn "t1": respond[0] answers "choices", which is not an input block.',
    ]);
    expect(await mockRules(rec({ respond: [{ block: "example_card", value: { why: "x" }, next: "t2" }] }))).toEqual([
      'mock-input: Turn "t1": respond[0] answers "example_card", which this turn doesn\'t show.',
    ]);
    const invalid = await mockRules(rec({ blocks: [card], respond: [{ block: "example_card", value: { why: "" }, next: "t2" }] }));
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatch(/^mock-input: Turn "t1": respond\[0\] is not a valid answer: why /);
    expect(await mockRules(rec({ blocks: [card], respond: [{ block: "example_card", value: { why: "x" }, next: "t9" }] }))).toEqual([
      'mock-next: Turn "t1": respond[0] leads to "t9", which is not a turn.',
    ]);
  });
});

describe("check: settings", () => {
  const AFTER = '  questions: { tier: "light" },';
  const tone = (extra = "") =>
    `tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone", options: { patient: "Patient", demanding: "Demanding" }, agent: "Use a {{value:label}} tone."${extra} }`;
  const withSettings = (fields: string, sections = "") => (d: string) =>
    replaceIn(d, "harness.config.ts", AFTER, `${AFTER}\n  settings: { tab: "How I learn",${sections} fields: { ${fields} } },`);
  const settingsRules = (r: CheckResult) =>
    r.findings.filter((f) => f.rule === "settings-tokens" || f.message.startsWith("settings.")).map((f) => `${f.severity}:${f.rule}:${f.message.split(":")[0]}`);

  it("a valid declaration gives no finding", async () => {
    const r = await checkHarness(await fixture(withSettings(tone())));
    expect(errors(r)).toEqual([]);
    expect(settingsRules(r)).toEqual([]);
  });

  it("schema: a default, an option, a section and a placeholder that don't fit", async () => {
    const r = await checkHarness(
      await fixture(
        withSettings(
          `${tone()}, pace: { schema: z.enum(["slow", "fast"]), default: "slow", control: "select", label: "Pace", options: { slow: "Slow", nope: "Nope" } }, hint: { schema: z.number().min(1), default: 0, section: "nope", control: "number", label: "Hint", agent: "After {{tries}} tries." }`,
          ' sections: [{ id: "help", label: "Help" }],',
        ),
      ),
    );
    expect(r.harness).toBeNull();
    expect(settingsRules(r).sort()).toEqual([
      "error:schema:settings.fields.hint.agent",
      "error:schema:settings.fields.hint.default",
      "error:schema:settings.fields.hint.section",
      "error:schema:settings.fields.pace.options.nope",
    ]);
  });

  it("settings-tokens: warns when the sentences make a long section", async () => {
    const long = "Explain every step slowly and check that the person follows before going on, using {{value}} as the level of detail. ".repeat(2).trim();
    const fields = Array.from({ length: 8 }, (_, i) => `f${i}: { schema: z.number(), default: ${i}, control: "number", label: "F${i}", agent: ${JSON.stringify(long)} }`).join(", ");
    const r = await checkHarness(await fixture(withSettings(fields)));
    expect(errors(r)).toEqual([]);
    const found = r.findings.filter((f) => f.rule === "settings-tokens");
    expect(found.map((f) => f.severity)).toEqual(["warning"]);
    expect(found[0].message).toMatch(/^The settings' sentences take about \d+ tokens of AGENTS\.md \(more than 400\)/);
  });
});

describe("check: setup steps (setup-steps spec §6)", () => {
  const setupRules = (r: CheckResult) => r.findings.filter((f) => f.rule.startsWith("setup-")).map((f) => `${f.severity}:${f.rule}`);
  const withSetup = (context: string) => (d: string) =>
    replaceIn(
      d,
      "harness.config.ts",
      "  // Free questions",
      [
        `  data: { profile: { scoped: false, single: true, schema: z.object({ name: z.string().min(1).max(40) }), agent: "write"${context} } },`,
        "  setup: [",
        '    { id: "intro", kind: "interview", label: "Get to know you", action: "example", writes: "profile" },',
        '    { id: "ready", kind: "component", label: "Ready check", component: "ReadyStep" },',
        "  ],",
        "  // Free questions",
      ].join("\n"),
    );
  // A second action with its own recording: mock/ holds a recording, and the interview's action has none.
  const withOtherRecording = (d: string) => {
    replaceIn(d, "harness.config.ts", "    example: {", '    meet: { label: "Meet", description: "Says hello.", prompt: "./agent/tasks/meet.md", cost: "light", tier: "standard" },\n    example: {');
    replaceIn(d, "HARNESS.md", "| (questions) |", "| meet | standard | light | Says hello |\n| (questions) |");
    fs.writeFileSync(path.join(d, "agent", "tasks", "meet.md"), "# Task: meet\n\nSay hello in {{language}}.\n");
    fs.mkdirSync(path.join(d, "mock"));
    const recording = { version: 1, action: "meet", match: "# Task: meet", turns: [{ id: "t1", text: "hello" }] };
    fs.writeFileSync(path.join(d, "mock", "meet.json"), JSON.stringify(recording));
  };

  it("D0: the template has no setup findings", async () => {
    expect(setupRules(await checkHarness(await fixture()))).toEqual([]);
  });

  it("warns: a component not registered in ui/, an interview with no recording, a collection the agent can't see", async () => {
    const r = await checkHarness(
      await fixture((d) => {
        withSetup("")(d);
        withOtherRecording(d);
      }),
    );
    expect(errors(r)).toEqual([]);
    expect(setupRules(r)).toEqual(["warning:setup-component", "warning:setup-mock", "warning:setup-context"]);
    expect(r.findings.find((f) => f.rule === "setup-component")?.message).toContain('"ReadyStep"');
    expect(r.findings.find((f) => f.rule === "setup-mock")?.message).toContain("mock/example.json");
  });

  it("a registered component and a collection with context clear their warnings; no mock/ means no setup-mock", async () => {
    const dir = await fixture((d) => {
      withSetup(', context: { fields: "all", tokens: 100 }')(d);
      fs.appendFileSync(path.join(d, "ui", "App.tsx"), "\nexport const setupStepComponents = { ReadyStep: () => null };\n");
    });
    const r = await checkHarness(dir);
    expect(errors(r)).toEqual([]);
    expect(setupRules(r)).toEqual([]);
  });

  it("only files count as recordings: a folder named like one in mock/ asks for no recording", async () => {
    const r = await checkHarness(
      await fixture((d) => {
        withSetup(', context: { fields: "all", tokens: 100 }')(d);
        fs.mkdirSync(path.join(d, "mock", "old.json"), { recursive: true });
      }),
    );
    expect(r.findings.filter((f) => f.rule === "setup-mock")).toEqual([]);
  });
});

describe("check: sidekick (sidekick spec §3)", () => {
  const AFTER = '  questions: { tier: "light" },';
  const withSidekick = (block: string) => (d: string) => replaceIn(d, "harness.config.ts", AFTER, `${AFTER}\n  sidekick: ${block},`);
  const rules = (r: CheckResult) =>
    r.findings.filter((f) => f.rule === "sidekick-tips" || f.message.startsWith("sidekick.")).map((f) => `${f.severity}:${f.rule}`);

  it("short tips and known actions: no finding", async () => {
    const r = await checkHarness(await fixture(withSidekick('{ default: "off", tips: "Claims need a source." }')));
    expect(errors(r)).toEqual([]);
    expect(rules(r)).toEqual([]);
  });

  it("an unknown action is a schema error, reported once", async () => {
    const r = await checkHarness(await fixture(withSidekick('{ actions: { nope: "auto" } }')));
    expect(rules(r)).toEqual(["error:schema"]);
  });

  it("sidekick-tips: warns over 300 tokens, per purpose too", async () => {
    const long = JSON.stringify("Every claim needs a source from the reading list, cited in APA style with page numbers. ".repeat(20).trim());
    for (const tips of [long, `{ "prompt-coach": ${long} }`]) {
      const r = await checkHarness(await fixture(withSidekick(`{ tips: ${tips} }`)));
      const found = r.findings.filter((f) => f.rule === "sidekick-tips");
      expect(found.map((f) => f.severity)).toEqual(["warning"]);
      expect(found[0].message).toMatch(/^Sidekick's tips take about \d+ tokens \(more than 300\)/);
    }
  });
});
