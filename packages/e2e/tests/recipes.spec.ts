import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Locator, type Page, expect, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, makeSandbox, readJsonl, shellDir, usageFile } from "./helpers";

// Job recipes (tools spec slice 4, §7, §13): a job declares `steps`. Tool steps run with no model; the AI step runs
// only when its `when` holds and ends with step_output; the post-step may ask for another AI round (ctx.requestAi) up
// to `maxAi`, past which the run needs the person and offers `onLimit`; a failed tool step fails the run. The fixture
// (recipes-harness, single mode: Settings › Jobs) has a committed dist/ (packages/cli/test/recipes-fixture-dist.test.ts
// keeps it fresh); fake-claude answers the AI step's turns by their first words. D0 (prompt jobs only) is jobs.spec's,
// unchanged.
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../fake-agent/fixtures/recipes-harness");
const out = path.join(shellDir, "out", "recipes");
const script = (JSON.parse(fs.readFileSync(path.join(fixture, "fake-script.json"), "utf8")).scenarios as Record<string, ClaudeScript>).recipes;

/** One AI turn's tokens toward the cap: input + output + cache writes (fake-script.json's usage line). */
const TURN_TOKENS = 1200 + 80 + 0;

type Run = { run: string; job: string; trigger: string; status: string; summary: string; action?: string; tokens: number };
const runs = (s: Sandbox): Run[] => readJsonl<Run>(path.join(s.folder, ".harness", "jobs.jsonl"));
const runsOf = (s: Sandbox, job: string) => runs(s).filter((r) => r.job === job);
type Usage = {
  phase?: string;
  kind?: string;
  job?: string;
  task?: string;
  run?: string;
  toolSteps?: number;
  aiSteps?: number;
  ok?: boolean;
  usage?: { inputTokens: number; outputTokens: number; cacheWriteTokens: number };
};
const usage = (s: Sandbox): Usage[] => (fs.existsSync(usageFile(s)) ? readJsonl<Usage>(usageFile(s)) : []);
/** The AI step's usage lines of `run` (part 3's job lines, `task: <run>`). */
const aiLines = (s: Sandbox, run: string) => usage(s).filter((u) => u.phase === "job" && u.task === run && u.usage);

/** Job `label`'s group in Settings › Jobs. */
const group = (page: Page, label: string): Locator => page.getByRole("tabpanel", { name: "Jobs" }).getByRole("region", { name: label });
/** The tool line of `tool` (a button "<tool> · …" or "<tool> failed · …") inside `where`. */
const toolLine = (where: Locator, tool: string) => where.getByRole("button", { name: new RegExp(`^${tool} (·|failed ·) `) });

async function openJobs(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Jobs" }).click();
  await expect(page.getByRole("tabpanel", { name: "Jobs" })).toBeVisible();
}

/** Run now on `label`, then waits for its `n`th run (1-based) of job `id` to be logged. */
async function runNow(page: Page, s: Sandbox, label: string, id: string, n = 1): Promise<Run> {
  await group(page, label).getByRole("button", { name: "Run now" }).click();
  await expect.poll(() => runsOf(s, id).length, { timeout: 30_000 }).toBe(n);
  return runsOf(s, id)[n - 1]!;
}

/** A launch of the fixture's build on the Jobs tab; the sandbox and the app go away at the end, whatever happens. */
async function withApp(name: string, run: (page: Page, s: Sandbox) => Promise<void>) {
  const s = makeSandbox(name);
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: script }, path.join(out, "main", "index.js"), { HH_TEST_FAKE_SECRETS: "1" });
    app = launched.app;
    await launched.page.getByRole("button", { name: "Start Recipes" }).click();
    await openJobs(launched.page);
    await run(launched.page, s);
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // electron-vite directly (as jobs.spec): `humanharness dev --build` would first run `check`.
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});

test.afterAll(() => {
  fs.rmSync(out, { recursive: true, force: true });
});

test("a recipe with a conditional AI step, a post-step and one extra round ends ok", async () => {
  await withApp("recipes-triage", async (page, s) => {
    const run = await runNow(page, s, "Triage", "triage");
    expect(run).toMatchObject({ job: "triage", trigger: "manual", status: "ok", summary: "Triaged 1" });
    await expect(group(page, "Triage")).toContainText("OK");
    await expect(group(page, "Triage")).toContainText("Triaged 1");

    // Two AI turns (the first round, then the round the post-step asked for), each a job usage line of the run.
    const lines = aiLines(s, run.run);
    expect(lines.map((u) => u.job)).toEqual(["triage", "triage"]);
    expect(run.tokens).toBe(2 * TURN_TOKENS);
    expect(run.tokens).toBe(lines.reduce((n, u) => n + u.usage!.inputTokens + u.usage!.outputTokens + u.usage!.cacheWriteTokens, 0));

    // One recipe row: check-items, apply-triage twice; two AI steps.
    const rows = usage(s).filter((u) => u.kind === "recipe");
    expect(rows).toEqual([expect.objectContaining({ phase: "job", kind: "recipe", job: "triage", task: run.run, run: run.run, toolSteps: 3, aiSteps: 2, ok: true })]);

    // The second round's data was the post-step's request, not the first round's items.
    const prompts = readJsonl<{ prompt: string }>(s.claudePrompts).map((p) => p.prompt);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatch(/^Classify step:/);
    expect(prompts[0]).toContain("### items");
    expect(prompts[1]).toContain("### request");
    expect(prompts[1]).not.toContain("### items");
  });
});

test("Steps unfolds the run's calls", async () => {
  await withApp("recipes-steps", async (page, s) => {
    await runNow(page, s, "Triage", "triage");
    const row = group(page, "Triage");
    await expect(row).toContainText("Triaged 1");
    const steps = row.getByRole("button", { name: "Steps" });
    await expect(steps).toHaveAttribute("aria-expanded", "false");
    await steps.click();
    await expect(steps).toHaveAttribute("aria-expanded", "true");
    await expect(toolLine(row, "check-items")).toHaveCount(1);
    await expect(toolLine(row, "check-items")).toHaveAccessibleName(/^check-items · 2 items · /);
    await expect(toolLine(row, "apply-triage")).toHaveCount(2);
    await expect(row.getByText(`AI step: valid output · ${TURN_TOKENS.toLocaleString("en-US")} tokens`, { exact: true })).toHaveCount(2);
  });
});

test("Steps after a second run shows that run's calls, not the first run's", async () => {
  await withApp("recipes-steps-rerun", async (page, s) => {
    await runNow(page, s, "Triage", "triage");
    const row = group(page, "Triage");
    const steps = row.getByRole("button", { name: "Steps" });
    await steps.click();
    await expect(toolLine(row, "apply-triage")).toHaveCount(2);

    // The next AI turns answer with no extra round: the second run has one AI step and one post-step call.
    // Rewriting the script mid-test works because fake-claude rereads HH_FAKE_SCRIPT on each start (fake-claude.ts:30).
    const scriptFile = fs.readdirSync(s.root).map((f) => path.join(s.root, f)).find((f) => /script-.*\.json$/.test(f) && fs.readFileSync(f, "utf8").includes("Classify step:"))!;
    const once: ClaudeScript = {
      ...script,
      turns: script.turns!.map((t) =>
        t.match !== "^Classify step:" ? t : { ...t, steps: t.steps.map((st) => ("mcp" in st ? { mcp: { ...st.mcp, args: { ids: ["a"], again: false } } } : st)) },
      ),
    };
    fs.writeFileSync(scriptFile, JSON.stringify(once));

    const second = await runNow(page, s, "Triage", "triage", 2);
    expect(second).toMatchObject({ status: "ok", summary: "Triaged 1", tokens: TURN_TOKENS });
    // Folded or not after the new run, once open it shows the second run's trace only.
    if ((await steps.getAttribute("aria-expanded")) !== "true") await steps.click();
    await expect(toolLine(row, "check-items")).toHaveCount(1);
    await expect(toolLine(row, "apply-triage")).toHaveCount(1);
    await expect(row.getByText(/^AI step: valid output · /)).toHaveCount(1);
  });
});

test("when false skips the AI step", async () => {
  await withApp("recipes-quiet", async (page, s) => {
    const run = await runNow(page, s, "Quiet", "quiet");
    expect(run).toMatchObject({ status: "ok", summary: "1 step · check-items: 2 items", tokens: 0 });
    await expect(group(page, "Quiet")).toContainText("OK");
    await expect(group(page, "Quiet")).toContainText("1 step · check-items: 2 items");
    // No step slot opened: no AI usage line for the run, and the engine was never started.
    expect(aiLines(s, run.run)).toEqual([]);
    expect(fs.existsSync(s.claudePrompts) ? readJsonl(s.claudePrompts) : []).toEqual([]);
    expect(usage(s).filter((u) => u.kind === "recipe")).toEqual([expect.objectContaining({ job: "quiet", run: run.run, toolSteps: 1, aiSteps: 0, ok: true })]);
  });
});

test("a request past maxAi needs the person and offers the action", async () => {
  await withApp("recipes-capped", async (page, s) => {
    const run = await runNow(page, s, "Capped", "capped");
    expect(run).toMatchObject({ status: "needs-you", summary: "Stopped after 1 AI step · Triaged 1", action: "write-a", tokens: TURN_TOKENS });
    const row = group(page, "Capped");
    await expect(row).toContainText("Needs you");
    await expect(row).toContainText("Stopped after 1 AI step · Triaged 1");

    // "Start" opens a Write A task.
    await row.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("main").getByText("Wrote a.")).toBeVisible({ timeout: 30_000 });
    expect(fs.readFileSync(path.join(s.folder, "a.md"), "utf8")).toBe("a\n");
  });
});

test("a failed tool step fails the run", async () => {
  await withApp("recipes-broken", async (page, s) => {
    const run = await runNow(page, s, "Broken", "broken");
    expect(run).toMatchObject({ status: "failed", summary: "boom failed: boom", tokens: 0 });
    const row = group(page, "Broken");
    await expect(row).toContainText("Failed");
    await expect(row).toContainText("boom failed: boom");
    await row.getByRole("button", { name: "Steps" }).click();
    const line = toolLine(row, "boom");
    await expect(line).toHaveAccessibleName("boom failed · boom");
    // A failed call starts unfolded.
    await expect(line).toHaveAttribute("aria-expanded", "true");
    expect(usage(s).filter((u) => u.kind === "recipe")).toEqual([expect.objectContaining({ job: "broken", toolSteps: 1, aiSteps: 0, ok: false })]);
  });
});
