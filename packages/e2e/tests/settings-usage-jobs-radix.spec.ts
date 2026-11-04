import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";
import { claudeScript } from "./scripts";

// Radix + Impeccable stage 2c: Settings › Usage and Jobs, built from the guide's Radix pieces. The screenshots go
// next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
// Jobs need a harness that declares them: the jobs fixture, built once (as jobs.spec builds it, in its own out dir).
const fixture = path.resolve(here, "../../fake-agent/fixtures/jobs-harness");
const out = path.join(shellDir, "out", "jobs-radix");
const jobsScript = (JSON.parse(fs.readFileSync(path.join(fixture, "fake-script.json"), "utf8")).scenarios as Record<string, ClaudeScript>).jobs;

test.beforeAll(() => {
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});
test.afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

async function openTab(page: Page, theme: "light" | "dark", tab: string) {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(400);
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `settings-${name}.png`), fullPage: true });

for (const theme of ["light", "dark"] as const) {
  test(`Settings › Usage with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-usage-radix-${theme}`);
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      // One answered task, as look.spec runs it, so the plan window and a topic have numbers.
      await page.getByRole("button", { name: "Start Demo" }).click();
      await page.getByRole("button", { name: /The manifest/ }).first().click();
      await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
      await page.getByRole("radio", { name: "Seguir el recorrido →" }).click();
      await expect(page.getByRole("main").getByText("Los motores se detectan en cada inicio.")).toBeVisible();
      await openTab(page, theme, "Usage");
      const usage = page.getByRole("tabpanel", { name: "Usage" });
      await expect(usage.getByText("15% used")).toBeVisible();
      await expect(usage.getByRole("table", { name: "How much each topic uses" })).toBeVisible();
      await expect(usage.getByRole("row", { name: /The manifest/ }).getByRole("cell")).toHaveText(["≈ 4% of 5 h", "about 25 times"]);
      await shot(page, `usage-radix-${theme}`);
    } finally {
      await closeAndClean(app, s);
    }
  });

  test(`Settings › Jobs with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-jobs-radix-${theme}`);
    const { app, page } = await launch(s, { claude: jobsScript }, path.join(out, "main", "index.js"));
    try {
      await page.getByRole("button", { name: "Start Jobs" }).click();
      await openTab(page, theme, "Jobs");
      const panel = page.getByRole("tabpanel", { name: "Jobs" });
      const group = (label: string) => panel.getByRole("region", { name: label });
      await expect(group("Sync")).toContainText("OK");
      await group("Check").getByRole("button", { name: "Run now" }).click();
      await expect(group("Check")).toContainText("Needs you");
      await shot(page, `jobs-radix-${theme}`);
      // A run unfolds to its summary and steps.
      await group("Check").getByRole("button", { expanded: false }).first().click();
      await expect(group("Check").getByText("2 tickets without AC")).toBeVisible();
      await shot(page, `jobs-radix-${theme}-open`);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
