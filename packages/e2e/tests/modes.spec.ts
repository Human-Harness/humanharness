import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir, usageFile } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/modes-harness");
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
// First match wins: the switch prompts before the task's brief, which the first message alone carries.
const coachScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["Two halves make a whole"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    { match: 'From now on work in the mode "Worked examples"', steps: [...claudeTextLines("Paso uno: partimos la pizza."), result] },
    { match: 'From now on work in the mode "Socratic"', steps: [...claudeTextLines("¿Qué es una mitad?"), result] },
    {
      match: "# Task: study",
      steps: [
        ...claudeTextLines("Elijamos cómo trabajar."),
        ui("show_recommend_mode", { recommended: "socratic", reasons: ["Hay una idea clave para descubrir."], alternatives: [{ mode: "feynman", why: "Para explicarlo con tus palabras." }] }),
        result,
      ],
    },
  ],
};
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));

test("the agent recommends, the person picks, the switch carries the mode's settings; a mode above the tier asks first", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("modes");
  const outDir = path.join(shellDir, "out", "modes");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;

  const settingsFile = path.join(s.folder, ".harness", "data", "_app", "settings.json");
  const storedSettings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : null);
  const agents = () => fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
  // Inside the try: a failed build or launch still removes the sandbox and the build.
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const launched = await launch(s, { claude: coachScript }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    // Mode settings: a section of the harness's tab, stored under modes.<mode>.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    const tab = page.getByRole("tabpanel", { name: "How I learn" });
    await expect(tab.getByRole("heading", { name: "Socratic" })).toBeVisible();
    await tab.getByRole("group", { name: "Questions" }).getByRole("button", { name: "Many" }).click();
    await expect.poll(storedSettings).toEqual({ modes: { socratic: { questions: "many" } } });
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // The task starts asking for a recommendation; the block draws it.
    await page.getByRole("button", { name: "Start Coach" }).click();
    await page.getByRole("button", { name: /Study/ }).first().click();
    const recommend = page.getByRole("group", { name: "How do we work?" });
    await expect(recommend.getByRole("button", { name: /Socratic/ })).toContainText("Recommended");
    const bar = page.getByRole("group", { name: "Task mode" });
    await expect(bar).toContainText("No mode chosen yet");
    // The managed AGENTS.md section lists the block's tool (only a harness with modes has it).
    expect(agents()).toContain("show_recommend_mode");

    // The pick switches in the same session: a system line, the agent's answer in the new mode.
    await recommend.getByRole("button", { name: /Socratic/ }).click();
    await expect(page.locator(".hh-message.system > .hh-mode-line")).toHaveText("Switched to Socratic");
    await expect(page.getByRole("main").getByText("¿Qué es una mitad?")).toBeVisible();
    await expect(bar).toContainText("Mode: Socratic");
    const prompts = () => readJsonl<{ prompt: string; argv: string[] }>(s.claudePrompts);
    const [first, socratic] = prompts();
    expect(first.prompt).toContain("## How to work");
    expect(socratic.prompt).toContain('From now on work in the mode "Socratic"');
    expect(socratic.prompt).toContain("- Ask many questions before explaining.");
    expect(socratic.argv).toContain("--resume");
    await expect.poll(() => readTasks(s.folder).current).toMatchObject({ action: "study", mode: "socratic", modes: ["socratic"], status: "waiting" });
    await expect.poll(() => readJsonl<{ mode?: string }>(usageFile(s)).map((r) => r.mode)).toEqual([undefined, "socratic"]);
    // Mode settings never go into AGENTS.md.
    expect(agents()).not.toContain("questions before explaining");

    // During the task a mode setting saves at once and is never Pending: it applies the next time the mode starts.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    await tab.getByRole("group", { name: "Questions" }).getByRole("button", { name: "Few" }).click();
    await expect(tab.getByRole("group", { name: "Questions" }).getByRole("button", { name: "Few" })).toHaveAttribute("aria-pressed", "true");
    // Back to the default: nothing of it stays stored.
    await expect.poll(() => storedSettings()?.modes).toBeUndefined();
    await expect(tab.getByText("Pending")).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // Worked examples asks for the deep tier; the task runs at standard: the question comes first.
    await bar.getByRole("button", { name: "Change mode" }).click();
    await bar.getByRole("button", { name: "Worked examples" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Worked examples asks for more power" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue with the current model" }).click();
    await expect(page.getByRole("main").getByText("Paso uno: partimos la pizza.")).toBeVisible();
    await expect(page.locator(".hh-message.system > .hh-mode-line")).toHaveText(["Switched to Socratic", "Switched to Worked examples"]);
    const worked = prompts()[2];
    expect(worked.prompt).toContain('From now on work in the mode "Worked examples"');
    expect(worked.argv).toContain("--resume");
    await expect.poll(() => readTasks(s.folder).current).toMatchObject({ mode: "worked", modes: ["socratic", "worked"], belowMinTier: true });
    await expect(bar).toContainText("Running below the level this mode asks for");
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
