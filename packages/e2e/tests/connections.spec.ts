import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, makeSandbox, shellDir } from "./helpers";

// The harness's keys (tools spec §9): the connect step and Settings › Connections, on the test crypto
// (HH_TEST_FAKE_SECRETS=1), never the Keychain.
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/secrets-harness");
const out = path.join(shellDir, "out", "connections");
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
const script: ClaudeScript = { steps: [...claudeTextLines("Listo."), result], turns: [] };
const TOKEN = "tok-e2e-123456789";

let s: Sandbox;
let app: ElectronApplication | undefined;
let page: Page;
/** Where the harness's key lands: the shared folder, `_harness/`, one file per key. */
const keyFile = () => path.join(s.sharedDir, "secrets", "secrets", "_harness", "jira.bin");
const row = () => page.getByRole("group", { name: "Jira API token" });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // electron-vite directly (as hatches-engine.spec): `humanharness dev --build` would first run `check`.
  test.setTimeout(600_000);
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: out };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  s = makeSandbox("connections");
  const launched = await launch(s, { claude: script }, path.join(out, "main", "index.js"), { HH_TEST_FAKE_SECRETS: "1" });
  app = launched.app;
  page = launched.page;
});

test.afterAll(async () => {
  try {
    if (app) await closeAndClean(app, s);
    else if (s) fs.rmSync(s.root, { recursive: true, force: true });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the connect step asks for the key, then Next", async () => {
  // Home waits for the required connect step.
  await expect(page.getByText("One step left: Connect Jira")).toBeVisible();
  await page.getByRole("button", { name: "Set up Tracker" }).click();

  await expect(page.getByRole("heading", { name: "Connect Jira" })).toBeVisible();
  await expect(row()).toContainText("Not set");
  await expect(row()).toContainText("Create one at id.atlassian.com → Security → API tokens.");
  await expect(page.getByText("Paste each key to go on.")).toBeVisible();
  const next = page.getByRole("contentinfo").getByRole("button", { name: "Next" });
  await expect(next).toBeDisabled();
  await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);

  const field = row().getByPlaceholder("Paste the key");
  await field.fill(TOKEN);
  await row().getByRole("button", { name: "Save" }).click();
  await expect(field).toHaveValue("");
  await expect(row().getByText("Set", { exact: true })).toBeVisible();
  await expect(next).toBeEnabled();
  await expect(page.getByText("Paste each key to go on.")).toHaveCount(0);

  // Stored with the test crypto: a file under _harness/, never the value in the clear.
  const stored = fs.readFileSync(keyFile());
  expect(stored.toString()).toMatch(/^hh-test:/);
  expect(stored.toString()).not.toContain(TOKEN);

  await next.click();
  await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
  await expect
    .poll(() => JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "setup.json"), "utf8")).steps)
    .toMatchObject({ jira: { state: "done" } });
});

test("no value on screen", async () => {
  expect(await page.content()).not.toContain(TOKEN);
  // Nor in the window's state: the renderer never had it after Save.
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(TOKEN);
});

test("Settings › Connections shows it set, and Delete makes it Not set", async () => {
  await page.getByRole("button", { name: "Start Tracker" }).click();
  await expect(page.getByRole("button", { name: /Triage/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Connections" }).click();

  const panel = page.getByRole("tabpanel");
  const key = panel.getByRole("group", { name: "Jira API token" });
  await expect(key.getByText("Set", { exact: true })).toBeVisible();
  await expect(key.getByRole("button", { name: "Replace" })).toBeVisible();
  expect(await page.content()).not.toContain(TOKEN);

  await key.getByRole("button", { name: "Delete" }).click();
  await expect(key.getByText("Not set", { exact: true })).toBeVisible();
  await expect(key.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect.poll(() => fs.existsSync(keyFile())).toBe(false);
});
