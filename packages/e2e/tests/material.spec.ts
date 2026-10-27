import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fake-agent/fixtures");
/** A chapter whose cut is known: six fragments, none flagged by the checks. */
const chapter = path.resolve(here, "../fixtures/fractions.md");
const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
};
const tool = (server: string, name: string, args: Record<string, unknown>) => ({ mcp: { server, tool: name, args } });
const ids = Array.from({ length: 6 }, (_, i) => `fractions-${String(i + 1).padStart(3, "0")}`);

const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    // The stages answer through the material server (system mode); each prompt starts with its stage's marker.
    { match: "^material-review", steps: [tool("material", "material_review", { verdict: "good", fragments: [], issues: [] }), result] },
    {
      match: "^material-label",
      steps: [tool("material", "material_label", { fragments: ids.map((id) => ({ id, summary: "About fractions.", keywords: ["fracciones"], kind: "explanation" })) }), result],
    },
    { match: "^material-sheet", steps: [tool("material", "material_sheet", { sections: [{ id: "terms", markdown: "- fracción: a part of a whole" }] }), result] },
    { match: "save_note", steps: [tool("ui", "save_note", { title: "Fractions", summary: ["Equivalent"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    // A task reads a fragment and cites it.
    {
      match: "# Task: study",
      steps: [tool("material", "material_read", { id: "fractions-002" }), ...claudeTextLines("Two fractions are equivalent when they name the same amount [[frag:fractions-002]]."), result],
    },
  ],
};

/** Adds a student from the profile screen (profiles.spec.ts): the fixture has no setup steps. */
async function addStudent(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: "Who's using Reader?" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("contentinfo").getByRole("button", { name: "Next" }).click();
}

/** Creates and opens the topic "Fractions" (ScopePicker). */
async function openFractions(page: Page) {
  await page.getByRole("button", { name: "New topic" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Fractions");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("combobox", { name: "Choose topic" })).toHaveValue("fractions");
}

/** Builds the shell for one fixture into its own out folder (profiles.spec.ts). */
function build(name: string, fixture: string): string {
  const outDir = path.join(shellDir, "out", name);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  return outDir;
}

test("material: add a chapter, the stages run, a task cites it, another student has their own", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("material");
  let outDir: string | undefined;
  let app: ElectronApplication | undefined;
  try {
    outDir = build("material", path.join(fixtures, "material-harness"));
    const launched = await launch(s, { claude: script }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;

    await page.getByRole("button", { name: "Set up Reader" }).click();
    await addStudent(page, "Ana");
    await page.getByRole("button", { name: "Start Reader" }).click();
    await openFractions(page);

    // No dialog in tests: the main process's dialog answers with the chapter.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as unknown as typeof dialog.showOpenDialog;
    }, chapter);
    await page.getByRole("button", { name: "Add a file" }).click();
    await expect(page.getByText("Checking and labelling send parts of this material to Anthropic.")).toBeVisible();
    await expect(page.getByText("fractions.md: ready, 6 fragments")).toBeVisible({ timeout: 60_000 });

    const ana = path.join(s.folder, "ana");
    const store = path.join(ana, ".harness", "material", "fractions");
    expect(fs.existsSync(path.join(ana, "material", "fractions", "fractions.md"))).toBe(true);
    const registry = JSON.parse(fs.readFileSync(path.join(store, "sources.json"), "utf8"));
    expect(registry.sources[0]).toMatchObject({ id: "fractions", status: "ready", verdict: "good", fragments: ids });
    await expect.poll(() => fs.existsSync(path.join(store, "sheet.md"))).toBe(true);
    expect(fs.readFileSync(path.join(store, "sheet.md"), "utf8")).toContain("## Terms");
    const usage = readJsonl<{ phase?: string; stage?: string }>(path.join(ana, ".harness", "usage.jsonl"));
    // No concepts in the topic yet: the link stage has nothing to do and runs no session.
    expect(usage.filter((u) => u.phase === "material").map((u) => u.stage)).toEqual(["review", "label", "sheet"]);

    // A task: the first message holds the material section; the citation shows its source and location.
    await page.getByRole("button", { name: /Study/ }).first().click();
    await expect(page.getByRole("button", { name: /^fractions\.md, / })).toBeVisible();
    const prompts = fs.readFileSync(s.claudePrompts, "utf8");
    expect(prompts).toContain("## Material");
    expect(prompts).toContain("## Terms");
    await expect.poll(() => fs.readFileSync(path.join(ana, ".harness", "material-reads.jsonl"), "utf8")).toContain('"id":"fractions-002"');

    // Another student: their own topic, no material of Ana's.
    await page.getByRole("button", { name: "Add student" }).click();
    await addStudent(page, "Ben");
    await page.getByRole("button", { name: "Start Reader" }).click();
    await openFractions(page);
    await expect(page.getByRole("button", { name: "Add a file" })).toBeVisible();
    await expect(page.getByText(/fractions\.md: ready/)).toHaveCount(0);
    expect(fs.existsSync(path.join(s.folder, "ben", "material"))).toBe(false);
    expect(fs.existsSync(path.join(s.folder, "ben", ".harness", "material"))).toBe(false);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test("D0: a harness without material has no panel and no material files", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("material-d0");
  const plain: ClaudeScript = { steps: [...claudeTextLines("Una pregunta corta."), result] };
  let outDir: string | undefined;
  let app: ElectronApplication | undefined;
  try {
    outDir = build("material-d0", path.join(fixtures, "profiles-harness"));
    const launched = await launch(s, { claude: plain }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    const next = page.getByRole("contentinfo").getByRole("button", { name: "Next" });
    await page.getByRole("button", { name: "Set up Family Tutor" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Sofi");
    await next.click();
    await page.getByRole("textbox").first().fill("Fractions");
    await next.click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    await page.getByRole("button", { name: "Start Family Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByText("Una pregunta corta.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Material" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a file" })).toHaveCount(0);
    const sofi = path.join(s.folder, "sofi");
    expect(fs.existsSync(path.join(sofi, "material"))).toBe(false);
    expect(fs.existsSync(path.join(sofi, ".harness", "material"))).toBe(false);
    expect(fs.existsSync(path.join(sofi, ".harness", "material-reads.jsonl"))).toBe(false);
    expect(fs.readFileSync(s.claudePrompts, "utf8")).not.toContain("## Material");
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
