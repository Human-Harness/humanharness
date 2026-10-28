import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/setup-harness");
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
const data = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "data", tool, args } });
const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "About Sofi", summary: ["Wants to pass maths"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    {
      match: "# Task: conocerte",
      steps: [
        ...claudeTextLines("Hola, ¿cómo te llamás y qué querés aprender?"),
        data("data_put", { collection: "profile", record: { name: "Sofi", goal: "Pass maths" } }),
        ...claudeTextLines("Listo, ya podés tocar Next."),
        result,
      ],
    },
    { match: "# Task: practice", steps: [...claudeTextLines("Una pregunta corta."), result] },
  ],
};

test("a fresh setup: the interview started and left (the app quits) still keeps Home on Set up", async () => {
  test.setTimeout(300_000);
  // The folder is saved, the engine isn't: the setup screen starts at the engine.
  const s = makeSandbox("setup-fresh", { engineId: undefined });
  const outDir = path.join(shellDir, "out", "setup-fresh");
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const setupFile = path.join(s.folder, ".harness", "setup.json");
  const json = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const main = path.join(outDir, "main", "index.js");
    let launched = await launch(s, { claude: script }, main);
    app = launched.app;
    let page = launched.page;
    await page.getByRole("button", { name: "Set up Tutor" }).click();
    await page.getByRole("group", { name: "AI engines" }).getByRole("button", { name: /Claude/ }).click();
    const next = page.getByRole("contentinfo").getByRole("button", { name: "Next" });
    await expect(next).toBeEnabled();
    await next.click();

    // Saving the engine recorded the fresh folder, before the interview's task could write tasks.json.
    await expect(page.getByRole("heading", { name: "Get to know you" })).toBeVisible();
    expect(json(setupFile)).toEqual({ version: 1, steps: {} });
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Listo, ya podés tocar Next.")).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(s.folder, ".harness", "tasks.json"))).toBe(true);

    // The person quits before Next: on the next start the required interview still blocks.
    await app.close();
    app = undefined;
    launched = await launch(s, { claude: script }, main);
    app = launched.app;
    page = launched.page;
    await expect(page.getByText("One step left: Get to know you")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Tutor" })).toHaveCount(0);
    expect(json(setupFile)).toEqual({ version: 1, steps: {} });
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test("a harness's setup steps: Home waits for the interview, then forms, a component and All set", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("setup-steps");
  const outDir = path.join(shellDir, "out", "setup-steps");
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const harnessDir = path.join(s.folder, ".harness");
  const json = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const launched = await launch(s, { claude: script }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;

    // Home: the folder and engine are set, but the required interview isn't done.
    await expect(page.getByText("One step left: Get to know you")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Tutor" })).toHaveCount(0);
    await page.getByRole("button", { name: "Set up Tutor" }).click();

    // The setup screen opens at the interview, with the harness's steps after the engine.
    await expect(page.getByRole("heading", { name: "Get to know you" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem")).toHaveText([/Your folder/, /AI engine/, /Get to know you/, /How the AI talks/, /Your goal/, /Ready check/]);
    await expect(page.getByText("This conversation uses some of your AI plan.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Listo, ya podés tocar Next.")).toBeVisible();
    await expect.poll(() => json(path.join(harnessDir, "data", "_app", "profile.json"))).toMatchObject({ name: "Sofi", goal: "Pass maths" });

    // Next closes the interview's task (its note) and marks the step.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "How the AI talks" })).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();

    // A form over the record starts from what the interview saved.
    await expect(page.getByRole("heading", { name: "Your goal" })).toBeVisible();
    const goal = page.getByRole("textbox", { name: "Goal" });
    await expect(goal).toHaveValue("Pass maths");
    await goal.fill("Pass maths in June");
    await page.getByRole("button", { name: "Next" }).click();

    // The harness's own component ends its step.
    await expect(page.getByRole("heading", { name: "Ready check" })).toBeVisible();
    await page.getByRole("button", { name: "All good" }).click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    await expect
      .poll(() => json(path.join(harnessDir, "setup.json"))?.steps)
      .toMatchObject({ conocerte: { state: "done" }, estilo: { state: "skipped" }, goal: { state: "done" }, ready: { state: "done" } });
    // The app writes these files after the screen moves on: wait for them instead of reading once.
    await expect.poll(() => json(path.join(harnessDir, "setup.json"))?.finishedAt).toEqual(expect.any(String));
    await expect.poll(() => json(path.join(harnessDir, "data", "_app", "profile.json"))).toMatchObject({ name: "Sofi", goal: "Pass maths in June" });

    // The work screen: the interview is no topic.
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await expect(page.getByRole("button", { name: /Practice/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Get to know you/ })).toHaveCount(0);

    // Settings › How I learn lists the steps with their statuses.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    const list = page.getByRole("tabpanel");
    await expect(list.getByRole("listitem", { name: "Get to know you" })).toContainText("Done");
    await expect(list.getByRole("listitem", { name: "How the AI talks" })).toContainText("Skipped. You can do it now.");

    // A settings form edited from the list: the harness's own fields below follow at once.
    const estilo = list.getByRole("listitem", { name: "How the AI talks" });
    await estilo.getByRole("button", { name: "Edit" }).click();
    await estilo.getByRole("radio", { name: "Demanding" }).check();
    await estilo.getByRole("button", { name: "Save" }).click();
    await expect(estilo).toContainText("Done");
    await expect.poll(() => json(path.join(harnessDir, "data", "_app", "settings.json"))).toEqual({ tone: "demanding" });
    await expect(list.getByRole("group", { name: "Tone" }).getByRole("button", { name: "Demanding" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
