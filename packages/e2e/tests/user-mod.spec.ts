import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, copyIntoAppHome, launch, makeSandbox, shellDir } from "./helpers";

// Minimal-core 0b2: a mod written by hand in the app's home folder places its block in the layout, after the warning,
// and an edit to its source updates the block without a relaunch. The person's own layouts come later (0b2 PR 3): a
// fixture harness's layout puts { mod: "hello", block: "hello" } in the root stack's header.
const here = path.dirname(fileURLToPath(import.meta.url));
const hello = path.resolve(here, "../fixtures/user-mods/hello");
const harness = { id: "usermod", fixture: path.resolve(here, "../../fake-agent/fixtures/user-mod-harness"), out: path.join(shellDir, "out", "user-mod") };
const appMain = path.join(harness.out, "main", "index.js");

const script: ClaudeScript = {
  steps: [
    ...claudeTextLines("Listo."),
    { line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session", usage: { input_tokens: 10, output_tokens: 1 } } },
  ],
};

test.beforeAll(() => {
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: harness.fixture, HH_OUT_DIR: harness.out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
});
test.afterAll(() => fs.rmSync(harness.out, { recursive: true, force: true }));

test("a user mod's block shows after the warning and updates on an edit, without a relaunch", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("user-mod");
  // In the home folder before launch: the app lists it, off, until the person reviews it.
  const dir = copyIntoAppHome(s, harness.id, hello, path.join("mods", "hello"));
  const { app, page } = await launch(s, { claude: script }, appMain);
  try {
    await expect(page.getByText("Mod Hello is off")).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Mods" }).click();
    const tab = page.getByRole("tabpanel", { name: "Mods" });
    const sw = tab.getByRole("switch", { name: "Hello", exact: true });
    await expect(sw).not.toBeChecked();
    await sw.click();
    await expect(tab.getByText(/full access to your folder/)).toBeVisible();
    await tab.getByRole("button", { name: "Turn on" }).click();
    await expect(tab.getByRole("switch", { name: "Hello", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("main", { name: "Settings" })).toHaveCount(0);

    await expect(page.getByText("Hello", { exact: true })).toBeVisible();
    await expect(page.getByText("Mod Hello is off")).toHaveCount(0);

    // An edit in the home folder: rebuilt by main, imported again by the window.
    const ui = path.join(dir, "ui.tsx");
    fs.writeFileSync(ui, fs.readFileSync(ui, "utf8").replace("<p>Hello</p>", "<p>Hello again</p>"));
    await expect(page.getByText("Hello again", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Hello", { exact: true })).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});
