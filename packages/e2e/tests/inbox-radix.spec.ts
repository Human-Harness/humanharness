import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { ClaudeScript } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";

// Radix + Impeccable stage 4a: the Inbox and Jobs pages (DESIGN.md "Secondary pages"), built from the guide's Radix
// pieces. The screenshots go next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
// The demo has no parallel tasks: the parallel fixture's own build (it declares jobs too), as parallel.spec builds it.
const fixture = path.resolve(here, "../../fake-agent/fixtures/parallel-harness");
const out = path.join(shellDir, "out", "inbox-radix");
/** `slow`: write-a works 5 s, so write-b can finish (and wait for the person) meanwhile. */
const slow = (JSON.parse(fs.readFileSync(path.join(fixture, "fake-script.json"), "utf8")).scenarios as { slow: ClaudeScript }).slow;

test.beforeAll(() => {
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  test.setTimeout(300_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});
test.afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `${name}.png`), fullPage: true });
const rail = (page: Page) => page.getByRole("navigation", { name: "App" });

for (const theme of ["light", "dark"] as const) {
  test(`the Inbox and Jobs pages with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`inbox-radix-${theme}`);
    const { app, page } = await launch(s, { claude: slow }, path.join(out, "main", "index.js"));
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: "Start Parallel" }).click();
      const topic = (label: string) => page.getByRole("region", { name: "Where do we start?" }).getByRole("button", { name: new RegExp(label) });
      // One task working, one waiting for the person.
      await topic("Write A").click();
      await expect(page.getByRole("main").locator('[data-role="user"]')).toHaveCount(1);
      await page.locator("header.hh-task-head").getByRole("button", { name: "New task" }).click();
      await topic("Write B").click();
      await expect(page.getByRole("main").getByText("Wrote b.")).toBeVisible();

      // Jobs: its own page; Check's Run now leaves a result that needs the person.
      await rail(page).getByRole("button", { name: "Jobs", exact: true }).click();
      const jobs = page.getByRole("region", { name: "Jobs", exact: true });
      await expect(jobs.getByRole("heading", { level: 1, name: "Jobs" })).toBeFocused();
      const check = jobs.getByRole("region", { name: "Check", exact: true });
      await check.getByRole("button", { name: "Run now" }).click();
      await expect(check).toContainText("Needs you");
      await expect(page.locator(".hh-shell header.hh-topbar").getByRole("button", { name: /^Back to/ })).toBeVisible();
      await shot(page, `jobs-page-radix-${theme}`);

      // The Inbox: the rail's count, the sections and the job result.
      const inbox = rail(page).getByRole("button", { name: /^Inbox, \d+ waiting$/ });
      // Write B and the job result at least (Write A may be done too).
      await expect(inbox).toHaveAccessibleName(/^Inbox, [23] waiting$/);
      await inbox.click();
      const list = page.getByRole("region", { name: "Inbox", exact: true });
      await expect(list.getByRole("heading", { level: 1, name: "Inbox" })).toBeFocused();
      await expect(list.getByRole("region", { name: /^Waiting for you / }).getByRole("button", { name: /^Write B/ })).toBeVisible();
      await expect(list.getByRole("region", { name: /^Job results for you / })).toContainText("2 tickets without AC");
      await shot(page, `inbox-page-radix-${theme}`);
      // Narrow: 16 at the sides, the rail a row on top.
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(300);
      await shot(page, `inbox-page-radix-${theme}-narrow`);

      // Escape goes back to the chat.
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
      await expect(page.getByRole("main").getByRole("textbox")).toBeVisible();
    } finally {
      await closeAndClean(app, s);
    }
  });
}
