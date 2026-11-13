import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { appHomeOf, closeAndClean, copyIntoAppHome, launch, makeSandbox } from "./helpers";

// Minimal-core 0b2: a mod and a layout written by hand in the app's home folder. The person's layout `mine` places
// { mod: "hello", block: "hello" } in the root stack's header; picked in Settings › Mods, it shows the block after the
// mod's warning. An edit to the layout, the pick or the mod's source redraws the window without a relaunch. The
// screenshots of Settings › Mods' Layout section go next to look.spec's (gitignored) for the critique.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const hello = path.resolve(here, "../fixtures/user-mods/hello");
/** The demo harness, as the shell's default build ships it. */
const harnessId = "demo";

const script: ClaudeScript = {
  steps: [
    ...claudeTextLines("Listo."),
    { line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session", usage: { input_tokens: 10, output_tokens: 1 } } },
  ],
};

const children = [
  { type: "block", id: "home", content: { mod: "home", block: "home" } },
  { type: "block", id: "work", content: { core: "task" } },
];
const mine = (header: boolean) => `${JSON.stringify({ type: "stack", ...(header ? { header: { mod: "hello", block: "hello" } } : {}), children }, null, 2)}\n`;

/** Picks `name` in the Layout section's Select. */
async function pickLayout(page: Page, tab: Locator, name: string) {
  await tab.getByRole("combobox", { name: "Layout to show" }).click();
  await page.getByRole("option", { name }).click();
}

test("a picked user layout shows a user mod's block and follows edits, without a relaunch", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("user-mod");
  // In the home folder before launch: the mod (listed off until reviewed), the layout `mine`, and a broken one.
  const dir = copyIntoAppHome(s, harnessId, hello, path.join("mods", "hello"));
  const home = appHomeOf(s, harnessId);
  const layouts = path.join(home, "layouts");
  fs.mkdirSync(layouts, { recursive: true });
  fs.writeFileSync(path.join(layouts, "mine.json"), mine(true));
  fs.writeFileSync(path.join(layouts, "broken.json"), `${JSON.stringify({ type: "row", children: [] })}\n`);
  const { app, page } = await launch(s, { claude: script });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Mods" }).click();
    const tab = page.getByRole("tabpanel", { name: "Mods" });
    const sw = tab.getByRole("switch", { name: "Hello", exact: true });
    await expect(sw).not.toBeChecked();
    await sw.click();
    await expect(tab.getByText(/full access to your folder/)).toBeVisible();
    await tab.getByRole("button", { name: "Turn on" }).click();
    await expect(tab.getByRole("switch", { name: "Hello", exact: true })).toBeChecked();

    // The Layout section: the harness's main shown; a broken pick falls back and says why, with its .error.
    const section = tab.getByRole("region", { name: "Layout" });
    await expect(section.getByText("Showing main, from the app.")).toBeVisible();
    await pickLayout(page, tab, "broken · Yours");
    await expect(section.getByText(/^Passed over /).first()).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(layouts, "broken.json.error"))).toBe(true);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(300);
      await section.screenshot({ path: path.join(lookDir, `settings-mods-layout-problem-${theme}.png`) });
    }

    await pickLayout(page, tab, "mine · Yours");
    await expect(section.getByText("Showing mine, from your layouts.")).toBeVisible();
    await expect(section.getByText(/^Passed over /)).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8"))).toEqual({ layout: "mine" });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(300);
      await section.screenshot({ path: path.join(lookDir, `settings-mods-layout-${theme}.png`) });
      await page.screenshot({ path: path.join(lookDir, `settings-mods-layout-tab-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("main", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByText("Hello", { exact: true })).toBeVisible();

    // An edit to the layout file: the window redraws without the header.
    fs.writeFileSync(path.join(layouts, "mine.json"), mine(false));
    await expect(page.getByText("Hello", { exact: true })).toHaveCount(0, { timeout: 15_000 });
    fs.writeFileSync(path.join(layouts, "mine.json"), mine(true));
    await expect(page.getByText("Hello", { exact: true })).toBeVisible({ timeout: 15_000 });

    // An edit to the mod's source: rebuilt by main, imported again by the window.
    const ui = path.join(dir, "ui.tsx");
    fs.writeFileSync(ui, fs.readFileSync(ui, "utf8").replace("<p>Hello</p>", "<p>Hello again</p>"));
    await expect(page.getByText("Hello again", { exact: true })).toBeVisible({ timeout: 15_000 });

    // The pick cleared by hand in settings.json: back to the default, no header.
    fs.writeFileSync(path.join(home, "settings.json"), "{}\n");
    await expect(page.getByText("Hello again", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await closeAndClean(app, s);
  }
});
