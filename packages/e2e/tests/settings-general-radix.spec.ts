import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";
import { claudeScript } from "./scripts";

// Radix + Impeccable stage 2a: Settings' frame and General, built from the guide's Radix pieces. The screenshots go
// next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const fixtures = path.resolve(here, "../../fake-agent/fixtures");

async function openGeneral(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
  await page.waitForTimeout(300);
}

/** Builds the app with a fixture harness, the way parallel.spec and profiles.spec do. */
function build(fixture: string): string {
  const outDir = path.join(shellDir, "out", `settings-radix-${fixture}`);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: path.join(fixtures, fixture), HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  return outDir;
}

for (const theme of ["light", "dark"] as const) {
  test(`Settings › General with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-general-radix-${theme}`);
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await page.getByRole("button", { name: "Start Demo" }).click();
      await openGeneral(page, theme);
      // The way back names the place it goes to; the section list is a vertical tab list.
      await expect(page.getByRole("button", { name: /^Back to / })).toBeVisible();
      await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
      await expect(page.getByRole("radiogroup", { name: "Text size" })).toBeVisible();
      // The body is one reading column (Marco, 2026-11-04: 680).
      const width = await page.locator(".hh-settings-main > *").first().evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBeLessThanOrEqual(680);
      // A card title is ink, not the app's old muted h3.
      const about = page.getByRole("heading", { name: "About" });
      expect(await about.evaluate((el) => getComputedStyle(el).color)).not.toBe(await page.locator(".hh-settings-main p").first().evaluate((el) => getComputedStyle(el).color));
      await page.screenshot({ path: path.join(lookDir, `settings-general-radix-${theme}.png`) });
      // Narrow window: the section list turns into a row of tabs above the body, every tab in reach.
      await page.setViewportSize({ width: 560, height: 1100 });
      await page.waitForTimeout(300);
      await expect(page.getByRole("tab", { name: "Engine" })).toBeInViewport();
      await page.screenshot({ path: path.join(lookDir, `settings-general-radix-${theme}-narrow.png`) });
    } finally {
      await closeAndClean(app, s);
    }
  });
}

test.describe("with parallel tasks and profiles", () => {
  const built: Record<string, string> = {};
  test.beforeAll(() => {
    test.setTimeout(300_000);
    built.parallel = build("parallel-harness");
    built.profiles = build("profiles-harness");
  });
  test.afterAll(() => {
    for (const dir of Object.values(built)) fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`parallel caps, ${theme}`, async () => {
      test.setTimeout(120_000);
      const s = makeSandbox(`settings-radix-parallel-${theme}`);
      const { app, page } = await launch(s, { claude: claudeScript }, path.join(built.parallel!, "main", "index.js"));
      try {
        await openGeneral(page, theme);
        const card = page.locator("section", { has: page.getByRole("heading", { name: "Parallel tasks" }) });
        await expect(card.getByRole("combobox", { name: "Tasks at once" })).toBeVisible();
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(lookDir, `settings-general-radix-parallel-${theme}.png`) });
        await card.getByRole("combobox", { name: "Tasks at once" }).click();
        await expect(page.getByRole("option", { name: "3" })).toBeVisible();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(lookDir, `settings-general-radix-parallel-${theme}-open.png`) });
        await page.keyboard.press("Escape");
      } finally {
        await closeAndClean(app, s);
      }
    });

    test(`profiles list, ${theme}`, async () => {
      test.setTimeout(120_000);
      const s = makeSandbox(`settings-radix-profiles-${theme}`, { profile: "sofi" });
      // Two people already there: Sofi in use, Tomás archived.
      fs.mkdirSync(path.join(s.folder, ".harness"), { recursive: true });
      for (const id of ["sofi", "tomas"]) fs.mkdirSync(path.join(s.folder, id), { recursive: true });
      fs.writeFileSync(
        path.join(s.folder, ".harness", "profiles.json"),
        JSON.stringify({ version: 1, profiles: [{ id: "sofi", title: "Sofi", archived: false }, { id: "tomas", title: "Tomás", archived: true }] }),
      );
      const { app, page } = await launch(s, { claude: claudeScript }, path.join(built.profiles!, "main", "index.js"));
      try {
        await openGeneral(page, theme);
        const people = page.locator('[data-setting="general.profiles"]');
        await expect(people.getByRole("listitem", { name: "Tomás" })).toBeVisible();
        await people.scrollIntoViewIfNeeded();
        await people.getByRole("listitem", { name: "Tomás" }).getByRole("button", { name: "Delete…" }).click();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(lookDir, `settings-general-radix-profiles-${theme}.png`) });
      } finally {
        await closeAndClean(app, s);
      }
    });
  }
});
