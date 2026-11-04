import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";
import { claudeScript } from "./scripts";

// Radix + Impeccable stage 2e: Settings › Plugins (list, review, detail) and the harness tab, built from the guide's
// Radix pieces. The screenshots go next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const plugins = path.resolve(here, "../fixtures/plugins");
// The harness tab needs a harness with settings (settings-harness); the demo build has none.
const harness = { fixture: path.resolve(here, "../../fake-agent/fixtures/settings-harness"), out: path.join(shellDir, "out", "harness-radix") };

test.beforeAll(() => {
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: harness.fixture, HH_OUT_DIR: harness.out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});
test.afterAll(() => fs.rmSync(harness.out, { recursive: true, force: true }));

async function openTab(page: Page, theme: "light" | "dark", tab: string) {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(400);
  return page.getByRole("tabpanel", { name: tab });
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `settings-${name}.png`), fullPage: true });

for (const theme of ["light", "dark"] as const) {
  test(`Settings › Plugins with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-plugins-radix-${theme}`);
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      // Each Add from folder… picks the next folder: probe (a review with hosts and a command), then hello.
      await app.evaluate(({ dialog }, folders) => {
        let next = 0;
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folders[next++]] })) as unknown as typeof dialog.showOpenDialog;
      }, [path.join(plugins, "probe"), path.join(plugins, "hello")]);
      const tab = await openTab(page, theme, "Plugins");
      await tab.getByRole("button", { name: "Add from folder…" }).click();
      await expect(tab.getByRole("button", { name: "Turn on" })).toBeVisible();
      await shot(page, `plugins-radix-${theme}-review`);
      await tab.getByRole("button", { name: "Cancel" }).click();

      await tab.getByRole("button", { name: "Add from folder…" }).click();
      await tab.getByRole("button", { name: "Turn on" }).click();
      await expect(tab.getByRole("switch", { name: "Hello" })).toBeChecked();
      await shot(page, `plugins-radix-${theme}`);

      // The detail takes the list's place; the top bar goes back to the list, and so does Escape.
      await tab.locator('[data-plugin-open="hello"]').click();
      await expect(page.getByRole("button", { name: "Back to Plugins" })).toBeVisible();
      await shot(page, `plugins-radix-${theme}-detail`);
      await page.keyboard.press("Escape");
      await expect(tab.getByRole("switch", { name: "Hello" })).toBeVisible();
      await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
    } finally {
      await closeAndClean(app, s);
    }
  });

  test(`Settings › harness tab with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-harness-radix-${theme}`);
    const { app, page } = await launch(s, { claude: claudeScript }, path.join(harness.out, "main", "index.js"));
    try {
      const tab = await openTab(page, theme, "How I learn");
      await expect(tab.getByRole("radiogroup", { name: "Tone" })).toBeVisible();
      await shot(page, `harness-radix-${theme}`);
      await tab.getByRole("button", { name: "More options" }).click();
      await expect(tab.getByLabel("Hint after")).toBeVisible();
      await shot(page, `harness-radix-${theme}-more`);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
