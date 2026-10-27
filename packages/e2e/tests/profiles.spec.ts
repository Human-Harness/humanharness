import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/profiles-harness");
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
const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Practice", summary: ["One question"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    { match: "# Task: practice", steps: [...claudeTextLines("Una pregunta corta."), result] },
  ],
};

test("profiles: add two students, each with their own folder and setup, switch, archive, usage by person", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("profiles");
  const outDir = path.join(shellDir, "out", "profiles");
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const json = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  const registry = path.join(s.folder, ".harness", "profiles.json");
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const launched = await launch(s, { claude: script }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    const next = page.getByRole("contentinfo").getByRole("button", { name: "Next" });

    // Home: the folder and engine are set; no one uses the app yet.
    await expect(page.getByText("One step left: add a student")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Family Tutor" })).toHaveCount(0);
    expect(fs.existsSync(path.join(s.folder, ".harness", "tasks.json"))).toBe(false);
    await page.getByRole("button", { name: "Set up Family Tutor" }).click();

    // The first profile: no privacy note yet.
    await expect(page.getByRole("heading", { name: "Who's using Family Tutor?" })).toBeVisible();
    await expect(page.getByText(/they don't protect it/)).toHaveCount(0);
    await page.getByRole("textbox", { name: "Name" }).fill("Sofi");
    await next.click();

    // Sofi's own setup step, under her folder.
    await expect(page.getByRole("heading", { name: "Your goal" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Set up Family Tutor for Sofi" })).toBeVisible();
    await page.getByRole("textbox").first().fill("Fractions");
    await next.click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();

    expect(json(registry)).toMatchObject({ version: 1, profiles: [{ id: "sofi", title: "Sofi", archived: false }] });
    expect(json(path.join(s.userData, "config.json"))).toMatchObject({ profile: "sofi" });
    expect(json(path.join(s.folder, "sofi", ".harness", "data", "_app", "profile.json"))).toMatchObject({ name: "Sofi" });
    expect(json(path.join(s.folder, "sofi", ".harness", "data", "_app", "goal.json"))).toEqual({ text: "Fractions" });
    expect(fs.existsSync(path.join(s.folder, ".harness", "setup.json"))).toBe(false);

    // Sofi practises once: her usage.
    await page.getByRole("button", { name: "Start Family Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByText("Una pregunta corta.")).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(s.folder, "sofi", ".harness", "usage.jsonl"))).toBe(true);

    // Add a second student from the work screen: the open task closes; the privacy note shows once.
    await page.getByRole("button", { name: "Add student" }).click();
    await expect(page.getByRole("heading", { name: "Who's using Family Tutor?" })).toBeVisible();
    await expect(page.getByText(/they don't protect it/)).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill("Tomás");
    await next.click();
    await expect(page.getByRole("heading", { name: "Your goal" })).toBeVisible();
    await page.getByRole("textbox").first().fill("Reading");
    await next.click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    expect(json(path.join(s.userData, "config.json"))).toMatchObject({ profile: "tomas" });
    expect(json(path.join(s.folder, "tomas", ".harness", "data", "_app", "goal.json"))).toEqual({ text: "Reading" });
    expect(json(path.join(s.folder, "sofi", ".harness", "data", "_app", "goal.json"))).toEqual({ text: "Fractions" });

    // Switch back to Sofi from the work screen's top bar.
    await page.getByRole("button", { name: "Start Family Tutor" }).click();
    await page.getByRole("combobox", { name: "Choose student" }).selectOption("sofi");
    await expect.poll(() => json(path.join(s.userData, "config.json"))?.profile).toBe("sofi");

    // Settings › General › People: Tomás can be archived; Sofi is in use.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "General" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("listitem", { name: "Sofi" })).toContainText("In use now");
    await panel.getByRole("listitem", { name: "Tomás" }).getByRole("button", { name: "Archive" }).click();
    await expect(panel.getByRole("listitem", { name: "Tomás" }).getByRole("button", { name: "Bring back" })).toBeVisible();
    await expect.poll(() => json(registry)?.profiles?.find((p: { id: string }) => p.id === "tomas")?.archived).toBe(true);

    // Settings › Usage: by person.
    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(page.getByRole("list", { name: "Usage by person" }).getByRole("listitem").first()).toContainText("Sofi");
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
