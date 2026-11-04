import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";
import { twoSidekicksScript } from "./scripts";

// Radix + Impeccable stage 2d: Settings › Sidekick and Connections, built from the guide's Radix pieces. The
// screenshots go next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
// Sidekick needs a harness with a preset (sidekick-harness); Connections one with a key and a test (tools-harness).
const builds = {
  sidekick: { fixture: path.resolve(here, "../../fake-agent/fixtures/sidekick-harness"), out: path.join(shellDir, "out", "sidekick-radix") },
  tools: { fixture: path.resolve(here, "../../fake-agent/fixtures/tools-harness"), out: path.join(shellDir, "out", "connections-radix") },
};

test.beforeAll(() => {
  test.setTimeout(600_000);
  for (const b of Object.values(builds)) {
    const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: b.fixture, HH_OUT_DIR: b.out };
    delete env.ELECTRON_RUN_AS_NODE;
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  }
});
test.afterAll(() => {
  for (const b of Object.values(builds)) fs.rmSync(b.out, { recursive: true, force: true });
});

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
  test(`Settings › Sidekick with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-sidekick-radix-${theme}`);
    const { app, page } = await launch(s, { claude: twoSidekicksScript }, path.join(builds.sidekick.out, "main", "index.js"));
    try {
      await page.getByRole("button", { name: "Start Planner" }).click();
      await openTab(page, theme, "Sidekick");
      const tab = page.getByRole("tabpanel", { name: "Sidekick" });
      await tab.getByRole("switch", { name: "Sidekick" }).click();
      await expect(tab.getByRole("switch", { name: "Sidekick" })).toBeChecked();
      await expect(tab.getByRole("region", { name: "Suggested by the harness" })).toBeVisible();
      await shot(page, `sidekick-radix-${theme}`);
      // Adopting the preset makes a list of two; the second's editor opens under its row.
      await tab.getByRole("button", { name: "Add Guard" }).click();
      await expect(page.getByRole("tab", { name: "Sidekicks" })).toBeVisible();
      const many = page.getByRole("tabpanel", { name: "Sidekicks" });
      await many.getByRole("listitem", { name: "Guard" }).getByRole("button", { name: "Edit" }).click();
      await expect(many.getByRole("textbox", { name: "Name" })).toHaveValue("Guard");
      await shot(page, `sidekick-radix-${theme}-edit`);
    } finally {
      await closeAndClean(app, s);
    }
  });

  test(`Settings › Connections with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-connections-radix-${theme}`);
    const { app, page } = await launch(s, { claude: twoSidekicksScript }, path.join(builds.tools.out, "main", "index.js"), { HH_TEST_FAKE_SECRETS: "1", HH_TEST_MOCK: "1" });
    try {
      await openTab(page, theme, "Connections");
      const key = page.getByRole("tabpanel", { name: "Connections" }).getByRole("group", { name: "Demo key" });
      await expect(key.getByText("Not set · paste the key to use it", { exact: true })).toBeVisible();
      await key.getByRole("button", { name: "More for Demo key" }).click();
      await page.getByRole("menuitem", { name: "Test connection" }).click();
      await expect(key.getByRole("status")).toContainText("Didn't work");
      await shot(page, `connections-radix-${theme}`);
      await key.getByRole("button", { name: "More for Demo key" }).click();
      await expect(page.getByRole("menuitem", { name: "Test connection" })).toBeVisible();
      await shot(page, `connections-radix-${theme}-menu`);
      await page.keyboard.press("Escape");
    } finally {
      await closeAndClean(app, s);
    }
  });
}
