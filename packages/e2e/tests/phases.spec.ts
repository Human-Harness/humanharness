import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir, usageFile } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/phases-harness");
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
// First match wins: a phase change's prompt carries the brief, the first message alone carries the task's prompt.
const tutorScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Fractions", summary: ["Halves and quarters"], decisions: [], files: [], open: [] }), result] },
    { match: "Time is almost up:", steps: [...claudeTextLines("One last idea, quickly."), result] },
    { match: 'Next part of this task: "Close"', steps: [...claudeTextLines("Sum it up in three lines."), result] },
    {
      match: 'Next part of this task: "Main block"',
      steps: [...claudeTextLines("Let's split a pizza."), ui("set_phase", { to: "close", reason: "We covered quarters." }), result],
    },
    { match: "# Task: session", steps: [...claudeTextLines("What is a half?"), ui("set_phase", { to: "main", reason: "Recall done." }), result] },
  ],
};
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));

test("a session moves through its parts: auto, a proposal, the time box's wrap-up, Finish", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("phases");
  const outDir = path.join(shellDir, "out", "phases");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  // Inside the try: a failed build or launch still removes the sandbox and the build.
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    // A one-second minute: a 15-minute box wraps up at 12.75 s.
    const launched = await launch(s, { claude: tutorScript }, path.join(outDir, "main", "index.js"), { HH_TEST_MINUTE_MS: "1000" });
    app = launched.app;
    const page = launched.page;
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await page.getByRole("button", { name: /Session/ }).first().click();
    // The time box comes first (the stepper's time group shares the name, so the picker is the dialog).
    await page.getByRole("dialog", { name: "How long?" }).getByRole("button", { name: "15 min" }).click();
    const steps = page.getByRole("navigation", { name: "Task parts" });
    // The warm-up's auto: the app moved to the main block right after the first answer.
    await expect(page.getByText("— Main block —")).toBeVisible();
    await expect(steps.getByRole("button", { name: "Main block" })).toHaveAttribute("aria-current", "step");
    // No mode in the warm-up; the default mode came back with the main block.
    await expect(page.getByRole("group", { name: "Task mode" })).toContainText("Socratic");
    // The agent's request to skip ahead is a proposal.
    await expect(page.getByText("The AI proposes to move to Close: We covered quarters.")).toBeVisible();
    // The wrap-up, then the app moves to the close part on its own.
    await expect(page.getByText("Time is almost up", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("— Close —")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("group", { name: "Task mode" })).toHaveCount(0);
    // Finish runs the core closing turn: the note is written and the task is done.
    await page.getByRole("button", { name: "Finish" }).first().click();
    await expect.poll(() => readTasks(s.folder).current).toBeNull();
    expect(fs.existsSync(path.join(s.folder, ".harness", "notes", "session.md"))).toBe(true);
    const usage = readJsonl<{ phase?: string; taskPhase?: string }>(usageFile(s));
    expect(usage.map((u) => u.phase)).toEqual(["run", "phase-change", "wrap-up", "phase-change", "close"]);
    expect(usage.map((u) => u.taskPhase)).toEqual(["warmup", "main", "main", "close", "close"]);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
