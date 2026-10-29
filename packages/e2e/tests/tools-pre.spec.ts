import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, makeSandbox, readJsonl, shellDir, usageFile } from "./helpers";

// Harness tools, slice 3 (tools spec §6, §6.1, §8.2, §10, §13): pre-steps run when the person presses Start, before the
// session opens. The tools fixture's Study prepares two items (the second reads the first through `input`): both reach
// the first message under "## Prepared data", show as one folded group above the first answer and as start items in
// the context panel, and one `pre` row goes to usage.jsonl. Strict's required step fails, so it starts nothing. Study's
// Close part expects count-notes, which the closing turn never calls: the miss is counted and shown.
// Fake-claude and the test crypto (HH_TEST_FAKE_SECRETS=1) only: no network, no Keychain.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../fake-agent/fixtures/tools-harness");
/** Its own build (tools.spec builds out/tools): main finds the tool host's files through `__SHELL_RESOURCES__`. */
const out = path.join(shellDir, "out", "tools-pre");
const SAW = "Saw the prepared data.";
const PANEL = "What the AI takes into account";

const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
};
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
// First match wins. The first answer matches only when the first message holds both prepared blocks, in order; the
// close prompt saves a note and never calls count-notes.
const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "## Prepared data[\\s\\S]*### today · due-today[\\s\\S]*### warmup · pick-two",
      steps: [...claudeTextLines(SAW), ui("set_phase", { to: "close", reason: "Warm-up done." }), result],
    },
    { match: "save_note", steps: [ui("save_note", { title: "Study", summary: ["Fractions and decimals"], decisions: [], files: [], open: [] }), result] },
    { match: 'Next part of this task: "Close"', steps: [...claudeTextLines("Sum it up in three lines."), result] },
  ],
};

type Row = { kind?: string; action?: string; task?: string; steps?: number; ok?: boolean; taskPhase?: string; tool?: string; preparedTokens?: number };
type Run = { argv: string[]; prompt: string };

let s: Sandbox;
let app: ElectronApplication | undefined;
let page: Page;

const rows = () => (fs.existsSync(usageFile(s)) ? readJsonl<Row>(usageFile(s)) : []);
const readTasks = () => JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8")) as { current: unknown };
const line = (name: string) => page.locator(".hh-tool-call").filter({ has: page.getByRole("button", { name: new RegExp(`^${name} `) }) });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // electron-vite directly (as tools.spec): `humanharness dev --build` would first run `check`.
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  s = makeSandbox("tools-pre");
  const launched = await launch(s, { claude: script }, path.join(out, "main", "index.js"), { HH_TEST_FAKE_SECRETS: "1", HH_TEST_MOCK: "1" });
  app = launched.app;
  page = launched.page;
});

test.afterAll(async () => {
  try {
    if (app) await closeAndClean(app, s);
    else if (s) fs.rmSync(s.root, { recursive: true, force: true });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("a pre-step's result reaches the first message", async () => {
  await page.getByRole("button", { name: "Start Toolbox" }).click();
  await page.getByRole("button", { name: /Study/ }).first().click();
  // The script's turn matched: the first message held both blocks.
  await expect(page.getByRole("main").getByText(SAW)).toBeVisible({ timeout: 30_000 });
  const [first] = readJsonl<Run>(s.claudePrompts);
  expect(first.prompt).toContain("## Prepared data");
  // The second step got the first one's result through `input`: the first two of the three items, in a fence.
  expect(first.prompt).toMatch(/### today · due-today\nLists what is due today\.\n```json\n\[\{"id":"a","title":"Fractions"\},\{"id":"b","title":"Decimals"\},\{"id":"c","title":"Percentages"\}\]\n```/);
  expect(first.prompt).toMatch(/### warmup · pick-two\n[^\n]+\n```json\n\[\{"id":"a","title":"Fractions"\},\{"id":"b","title":"Decimals"\}\]\n```/);
});

test("the chat shows one folded group above the first answer", async () => {
  const group = page.locator(".hh-tool-group");
  await expect(group).toHaveCount(1);
  const button = group.getByRole("button").first();
  await expect(button).toHaveText(/^Prepared 2 items · \d+\.\d s · 0 tokens$/);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(line("due-today")).toBeHidden();
  // Above the answer.
  const groupBox = await group.boundingBox();
  const answerBox = await page.getByRole("main").getByText(SAW).boundingBox();
  expect(groupBox!.y).toBeLessThan(answerBox!.y);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(line("due-today").getByRole("button")).toHaveText(/^due-today · 3 items · \d+\.\d s · 0 tokens$/);
  await expect(line("pick-two").getByRole("button")).toHaveText(/^pick-two · 2 items · \d+\.\d s · 0 tokens$/);
  // Both inside the group, never streamed as lines of their own.
  await expect(page.locator(".hh-tool-call")).toHaveCount(2);
  await expect(group.locator(".hh-tool-call")).toHaveCount(2);
});

test("the context panel lists the prepared items", async () => {
  await page.getByRole("button", { name: PANEL }).click();
  const start = page.getByRole("region", { name: PANEL }).getByRole("region", { name: "At the start" });
  for (const name of ["today", "warmup"]) {
    const item = start.getByRole("listitem").filter({ hasText: `Prepared · ${name}` });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(/approx\. [\d,]+ tokens/);
    // No path, no actions.
    await expect(item.getByRole("button")).toHaveCount(0);
    await expect(item.getByRole("link")).toHaveCount(0);
  }
  await page.getByRole("region", { name: PANEL }).getByRole("button", { name: "Close" }).click();
});

test("a pre row is written", async () => {
  await expect.poll(() => rows().filter((r) => r.kind === "pre")).toHaveLength(1);
  const [pre] = rows().filter((r) => r.kind === "pre");
  expect(pre).toMatchObject({ kind: "pre", action: "study", steps: 2, ok: true });
  expect(pre.preparedTokens).toBeGreaterThan(0);
});

test("an expected tool not called is counted", async () => {
  // The agent moved Study to Close (Main is auto); Finish runs the closing turn, which saves a note without count-notes.
  await expect(page.getByText("— Close —")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Finish" }).first().click();
  await expect.poll(() => readTasks().current).toBeNull();
  await expect.poll(() => rows().filter((r) => r.kind === "expects-miss")).toHaveLength(1);
  const [miss] = rows().filter((r) => r.kind === "expects-miss");
  expect(miss).toMatchObject({ kind: "expects-miss", action: "study", taskPhase: "close", tool: "count-notes", ok: true });
  // The miss line reaches the chat (Decision 12): the close checks expects before the task ends.
  await expect(page.getByRole("main").getByText("Expected count-notes in Close: not called")).toBeVisible();
  // Main expects nothing: leaving it counted nothing.
  expect(rows().filter((r) => r.kind === "expects-miss" && r.taskPhase === "main")).toEqual([]);
});

test("a required pre-step that fails starts nothing", async () => {
  const runs = readJsonl<Run>(s.claudePrompts).length;
  await page.reload();
  await page.getByRole("button", { name: "Start Toolbox" }).click();
  await page.getByRole("button", { name: /Strict/ }).first().click();
  const card = page.getByRole("main").getByRole("alert").filter({ hasText: "Couldn't prepare this task" });
  await expect(card).toHaveText(/Couldn't prepare this task: always-fails failed: boom/, { timeout: 30_000 });
  await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
  // No task, no session: tasks.json has no current task and the engine never ran.
  expect(readTasks().current).toBeNull();
  expect(readJsonl<Run>(s.claudePrompts)).toHaveLength(runs);
  await expect.poll(() => rows().filter((r) => r.kind === "pre" && r.action === "strict")).toHaveLength(1);
  expect(rows().filter((r) => r.kind === "pre" && r.action === "strict")[0]).toMatchObject({ steps: 1, ok: false });

  // Try again resends the start: the pre-steps run again (a second row) and fail the same way.
  await card.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => rows().filter((r) => r.kind === "pre" && r.action === "strict")).toHaveLength(2);
  await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Couldn't prepare this task: always-fails failed: boom" })).toHaveCount(1);
  expect(readTasks().current).toBeNull();
  expect(readJsonl<Run>(s.claudePrompts)).toHaveLength(runs);
});
