import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ElectronApplication, type Locator, type Page, expect, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, makeSandbox, readJsonl, shellDir, usageFile } from "./helpers";

// Background jobs (parallel spec §8, §11): jobs declared in the manifest run with no chat and no person in the loop,
// end with a job_result, are logged in .harness/jobs.jsonl and show in the inbox's Jobs section (board mode) or in
// Settings › Jobs (single mode: jobs without `parallel`).
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fake-agent/fixtures");
const board = { fixture: path.join(fixtures, "parallel-harness"), out: path.join(shellDir, "out", "jobs-board"), start: "Start Parallel" };
const single = { fixture: path.join(fixtures, "jobs-harness"), out: path.join(shellDir, "out", "jobs-single"), start: "Start Jobs" };
type Build = typeof board;

const scenario = (b: Build, name: string): ClaudeScript =>
  (JSON.parse(fs.readFileSync(path.join(b.fixture, "fake-script.json"), "utf8")).scenarios as Record<string, ClaudeScript>)[name];
/** `parallel` with a sync run that writes a file, so the run makes a commit (the fixture's sync writes nothing). */
const syncWrites = (script: ClaudeScript): ClaudeScript => ({
  ...script,
  turns: script.turns!.map((t) =>
    t.match !== "^Sync job:" ? t : { ...t, steps: [t.steps[0], { write: { path: "synced.md", content: "synced\n" } }, ...t.steps.slice(1)] },
  ),
});

type Run = { run: string; job: string; scope: string | null; trigger: string; status: string; summary: string; action?: string; tokens: number };
const runs = (s: Sandbox): Run[] => readJsonl<Run>(path.join(s.folder, ".harness", "jobs.jsonl"));
const runsOf = (s: Sandbox, job: string) => runs(s).filter((r) => r.job === job);

// The e2e package doesn't depend on isomorphic-git: borrow the workspace package's copy, the one History writes with.
const gitEntry = createRequire(path.resolve(here, "../../workspace/package.json")).resolve("isomorphic-git");
type Git = { log(o: { fs: typeof fs; gitdir: string }): Promise<{ commit: { message: string } }[]> };
/** The folder's commit messages, oldest first. */
async function messages(s: Sandbox): Promise<string[]> {
  const git = ((await import(pathToFileURL(gitEntry).href)) as { default: Git }).default;
  // As historyDir (shell config.ts) derives it: one gitdir per folder, named by the folder's hash.
  const gitdir = path.join(s.userData, "history", createHash("sha256").update(s.folder).digest("hex").slice(0, 16));
  return (await git.log({ fs, gitdir })).reverse().map((e) => e.commit.message.trim());
}

const inboxButton = (page: Page) => page.getByRole("button", { name: /^Inbox, \d+ waiting$/ });
async function openInbox(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Inbox" });
  if (!(await dialog.isVisible())) await inboxButton(page).click();
  await expect(dialog).toBeVisible();
  return dialog;
}
/** Job `label`'s row in the inbox's Jobs section. */
const jobRow = (page: Page, label: string): Locator =>
  page
    .getByRole("dialog", { name: "Inbox" })
    .getByRole("region", { name: "Jobs" })
    .getByRole("listitem")
    .filter({ has: page.getByText(label, { exact: true }) });

/** A launch of `b`'s build; the sandbox and the app go away at the end, whatever happens. */
async function withApp(b: Build, name: string, script: ClaudeScript, run: (page: Page, s: Sandbox) => Promise<void>) {
  const s = makeSandbox(name);
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(s, { claude: script }, path.join(b.out, "main", "index.js"));
    app = launched.app;
    await launched.page.getByRole("button", { name: b.start }).click();
    await run(launched.page, s);
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  test.setTimeout(600_000);
  for (const b of [board, single]) {
    const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: b.fixture, HH_OUT_DIR: b.out };
    delete env.ELECTRON_RUN_AS_NODE;
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  }
});

test.afterAll(() => {
  for (const b of [board, single]) fs.rmSync(b.out, { recursive: true, force: true });
});

test("a start job runs once after setup, logs its run, commits with a Job: trailer and records its usage", async () => {
  await withApp(board, "jobs-start", syncWrites(scenario(board, "parallel")), async (page, s) => {
    await expect.poll(() => runsOf(s, "sync").length).toBe(1);
    const [sync] = runs(s);
    expect(sync).toMatchObject({ job: "sync", scope: null, trigger: "start", status: "ok", summary: "Synced" });
    expect(sync.tokens).toBeGreaterThan(0);

    await openInbox(page);
    const row = jobRow(page, "Sync");
    await expect(row).toContainText("OK");
    await expect(row).toContainText("Synced");
    await expect(row).toContainText(/Last run/);

    // The run's commit carries its run id and job; the file it wrote is in it.
    await expect.poll(async () => (await messages(s)).some((m) => /^Job: sync$/m.test(m))).toBe(true);
    const commit = (await messages(s)).find((m) => /^Job: sync$/m.test(m))!;
    expect(commit).toMatch(new RegExp(`^Task: ${sync.run}$`, "m"));
    expect(fs.readFileSync(path.join(s.folder, "synced.md"), "utf8")).toBe("synced\n");

    // Its usage line is a job's, apart from the tasks'.
    const usage = readJsonl<{ phase?: string; job?: string; task?: string }>(usageFile(s));
    expect(usage.filter((u) => u.phase === "job")).toEqual([expect.objectContaining({ phase: "job", job: "sync", task: sync.run })]);

    // Only once per app start: no other run comes.
    await page.waitForTimeout(1500);
    expect(runs(s)).toHaveLength(1);
  });
});

test("a needs-you result shows in the inbox, counts as waiting and starts its action", async () => {
  await withApp(board, "jobs-needs-you", scenario(board, "parallel"), async (page, s) => {
    await expect.poll(() => runsOf(s, "sync").length).toBe(1);
    await expect(inboxButton(page)).toHaveAccessibleName("Inbox, 0 waiting");
    await openInbox(page);
    await jobRow(page, "Check").getByRole("button", { name: "Run now" }).click();
    await expect.poll(() => runsOf(s, "check").map((r) => [r.trigger, r.status, r.action])).toEqual([["manual", "needs-you", "write-a"]]);
    const row = jobRow(page, "Check");
    await expect(row).toContainText("Needs you");
    await expect(row).toContainText("2 tickets without AC");
    await expect(inboxButton(page)).toHaveAccessibleName("Inbox, 1 waiting");

    // "Start" opens a Write A task, as its topic would.
    await row.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("dialog", { name: "Inbox" })).toBeHidden();
    await expect(page.getByRole("main").getByText("Wrote a.")).toBeVisible();
    expect(fs.readFileSync(path.join(s.folder, "a.md"), "utf8")).toBe("a\n");
    const lanes = (JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8")) as { lanes: { action?: string }[] }).lanes;
    expect(lanes.map((l) => l.action)).toEqual(["write-a"]);
  });
});

test("a job that tries to ask fails without asking, and one with no result fails", async () => {
  await withApp(board, "jobs-asker", scenario(board, "parallel"), async (page, s) => {
    await expect.poll(() => runsOf(s, "sync").length).toBe(1);
    await openInbox(page);
    await jobRow(page, "Asker").getByRole("button", { name: "Run now" }).click();
    await expect.poll(() => runsOf(s, "asker").map((r) => [r.status, r.summary])).toEqual([["failed", "Could not ask"]]);
    await expect(jobRow(page, "Asker")).toContainText("Failed");
    await expect(jobRow(page, "Asker")).toContainText("Could not ask");

    await jobRow(page, "Silent").getByRole("button", { name: "Run now" }).click();
    await expect.poll(() => runsOf(s, "silent").map((r) => [r.status, r.summary])).toEqual([["failed", "No result"]]);
    await expect(jobRow(page, "Silent")).toContainText("No result");

    // The asker's choices reached no one: no card anywhere, nothing waits for the person.
    await expect(page.getByRole("button", { name: "Tickets 1-3" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All of them" })).toHaveCount(0);
    await expect(inboxButton(page)).toHaveAccessibleName("Inbox, 0 waiting");
    // And opened no task: the tasks file (if any) has no lane.
    const tasksFile = path.join(s.folder, ".harness", "tasks.json");
    const lanes = fs.existsSync(tasksFile) ? (JSON.parse(fs.readFileSync(tasksFile, "utf8")) as { lanes?: unknown[] }).lanes ?? [] : [];
    expect(lanes).toEqual([]);
  });
});

test("two quick runs of the same job make one run", async () => {
  await withApp(board, "jobs-dedupe", scenario(board, "parallel"), async (page, s) => {
    await expect.poll(() => runsOf(s, "sync").length).toBe(1);
    // The start run is logged a moment before main clears its dedupe key: wait until it no longer runs.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const hh = (window as unknown as { hh: { jobs: { list: () => Promise<{ id: string; running: boolean }[]> } } }).hh;
          return (await hh.jobs.list()).find((j) => j.id === "sync")?.running;
        }),
      )
      .toBe(false);
    const asked = await page.evaluate(() => {
      const hh = (window as unknown as { hh: { jobs: { run: (id: string) => Promise<boolean> } } }).hh;
      return Promise.all([hh.jobs.run("sync"), hh.jobs.run("sync")]);
    });
    // One is queued, the other refused as a duplicate (main may answer them in either order).
    expect([...asked].sort()).toEqual([false, true]);
    await expect.poll(() => runsOf(s, "sync").filter((r) => r.trigger === "manual").length).toBe(1);
    await page.waitForTimeout(1500);
    expect(runsOf(s, "sync").map((r) => r.trigger)).toEqual(["start", "manual"]);
  });
});

test("single mode: a start job runs and a needs-you result shows in Settings › Jobs", async () => {
  await withApp(single, "jobs-single", scenario(single, "jobs"), async (page, s) => {
    await expect.poll(() => runsOf(s, "sync").map((r) => [r.trigger, r.status, r.summary])).toEqual([["start", "ok", "Synced"]]);
    // No inbox without `parallel`: the runs are in Settings › Jobs.
    await expect(inboxButton(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Jobs" }).click();
    const panel = page.getByRole("tabpanel", { name: "Jobs" });
    const group = (label: string) => panel.getByRole("region", { name: label });
    await expect(group("Sync")).toContainText("OK");
    await expect(group("Sync")).toContainText("Synced");
    await expect(group("Check")).toContainText("Not run yet");
    await group("Check").getByRole("button", { name: "Run now" }).click();
    await expect.poll(() => runsOf(s, "check").map((r) => [r.trigger, r.status])).toEqual([["manual", "needs-you"]]);
    await expect(group("Check")).toContainText("Needs you");
    await expect(group("Check")).toContainText("2 tickets without AC");
    const usage = readJsonl<{ phase?: string; job?: string }>(usageFile(s));
    expect(usage.filter((u) => u.phase === "job").map((u) => u.job)).toEqual(["sync", "check"]);
  });
});
