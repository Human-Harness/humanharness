import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/settings-harness");
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
const tutorScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["Two halves make a whole"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    { match: "# Task: practice", steps: [...claudeTextLines("Una pregunta corta."), ui("show_choices", { options: [{ label: "Next →", next: true }] }), result] },
    { match: "# Task: review", steps: [...claudeTextLines("Repasemos."), result] },
  ],
};

test("settings save at once; AGENTS.md takes them at the next task, never during one", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("settings");
  const outDir = path.join(shellDir, "out", "settings");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });

  const settingsFile = path.join(s.folder, ".harness", "data", "_app", "settings.json");
  const agents = () => fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
  const { app, page } = await launch(s, { claude: tutorScript }, path.join(outDir, "main", "index.js"));
  try {
    // Before any task: the tab saves at once; nothing runs, so nothing is pending.
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("tab")).toHaveText(["General", "How I learn", "Engine", "Models", "Usage"]);
    await page.getByRole("tab", { name: "How I learn" }).click();
    const tab = page.getByRole("tabpanel", { name: "How I learn" });
    await tab.getByRole("group", { name: "Tone" }).getByRole("button", { name: "Demanding" }).click();
    await expect.poll(() => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : null)).toEqual({ tone: "demanding" });
    await expect(tab.getByRole("status")).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // The first task's runtime writes AGENTS.md with the current settings.
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByRole("main").getByText("Una pregunta corta.")).toBeVisible();
    expect(agents()).toContain("### How to work with this person\n\n- Use a Demanding tone.\n- Give a hint after 2 failed tries, not before.\n");
    expect(agents()).not.toContain("worked examples");

    // During the task: the change is saved, marked Pending, and AGENTS.md doesn't move.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    await expect(tab.getByRole("status")).toHaveText("Changes apply from the next task.");
    await tab.getByRole("button", { name: "More options" }).click();
    const hint = tab.getByLabel("Hint after");
    await hint.fill("4");
    await hint.press("Tab");
    await expect(tab.getByText("Pending")).toBeVisible();
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({ tone: "demanding", hintAfter: 4 });
    expect(agents()).toContain("after 2 failed tries");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // Next: the task closes, AGENTS.md is rewritten, then the next task starts.
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByRole("main").getByText("Repasemos.")).toBeVisible();
    await expect.poll(agents).toContain("- Give a hint after 4 failed tries, not before.");
    const prompts = readJsonl<{ prompt: string }>(s.claudePrompts).map((p) => p.prompt);
    expect(prompts.some((p) => p.includes("# Task: review"))).toBe(true);

    // After the task: nothing pending.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    await expect(tab.getByText("Pending")).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
