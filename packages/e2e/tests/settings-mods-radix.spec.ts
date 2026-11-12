import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

// Minimal-core step 0a: Settings › Mods (list, the warning before a local mod) built from the guide's Radix pieces, and
// a harness mod's beforeSend rewriting a send. The screenshots go next to look.spec's (gitignored) for the critique.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
/** A local mod folder that registers nothing (id "echo-two"). */
const localEcho2 = path.resolve(here, "../fixtures/mods/echo-two");
// settings-harness plus the echo mod (`mods: { echo: { word: "pong" } }`): it rewrites "ping" into "pong".
const harness = { fixture: path.resolve(here, "../../fake-agent/fixtures/mods-harness"), out: path.join(shellDir, "out", "mods-radix") };
const appMain = path.join(harness.out, "main", "index.js");

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
/** The reply says which word reached the agent. */
const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "\\bpong\\b", steps: [...claudeTextLines("The agent got pong."), result] },
    { match: "\\bping\\b", steps: [...claudeTextLines("The agent got ping."), result] },
    { match: "# Task: practice", steps: [...claudeTextLines("Una pregunta corta."), result] },
  ],
};

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
  test(`Settings › Mods with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-mods-radix-${theme}`);
    const { app, page } = await launch(s, { claude: script }, appMain);
    try {
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
      }, localEcho2);
      const tab = await openTab(page, theme, "Mods");
      await expect(tab.getByRole("switch", { name: "Echo", exact: true })).toBeChecked();
      await expect(tab.getByText(/^Uses: beforeSend/)).toBeVisible();
      // Core and Harness mods carry no badge.
      await expect(tab.getByText("Local", { exact: true })).toHaveCount(0);
      await shot(page, `mods-radix-${theme}`);

      await tab.getByRole("button", { name: "Add from folder…" }).click();
      await expect(tab.getByText(/full access to your folder/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to Mods" })).toBeVisible();
      await shot(page, `mods-radix-${theme}-review`);
      await tab.getByRole("button", { name: "Turn on" }).click();
      await expect(tab.getByRole("switch", { name: "Echo two" })).toBeChecked();
      await expect(tab.getByText("Local", { exact: true })).toBeVisible();

      await tab.getByRole("switch", { name: "Echo", exact: true }).click();
      await expect(tab.getByRole("switch", { name: "Echo", exact: true })).not.toBeChecked();
    } finally {
      await closeAndClean(app, s);
    }
  });
}

test("the harness's echo mod rewrites a send: ping reaches the agent as pong", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("settings-mods-send");
  const { app, page } = await launch(s, { claude: script }, appMain);
  try {
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByRole("main").getByText("Una pregunta corta.")).toBeVisible();

    await page.getByRole("main").getByRole("textbox").fill("ping");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByText("The agent got pong.")).toBeVisible();
    const prompts = readJsonl<{ prompt: string }>(s.claudePrompts).map((p) => p.prompt);
    expect(prompts.at(-1)).toMatch(/\bpong\b/);
    expect(prompts.at(-1)).not.toMatch(/\bping\b/);
  } finally {
    await closeAndClean(app, s);
  }
});
