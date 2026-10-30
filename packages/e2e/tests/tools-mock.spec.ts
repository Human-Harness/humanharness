import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { type Sandbox, closeAndClean, launchMock, makeSandbox, shellDir } from "./helpers";

// Harness tools, slice 5 (tools spec §12, §13 "a mock-mode run answering from a recording"): in mock mode tools run for
// real, but their fetches are answered from mock/tools/<tool>/ and their keys are fixture-<id>. The fixture's Forecast
// prepares Lima's weather with a pre-step, then the recorded turn calls `weather` for Lima (recorded) and Oslo (not
// recorded). api.weather.test exists only in the recording: nothing reaches the network, the key store or the Keychain.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const cli = path.join(repo, "packages", "cli", "bin", "humanharness.js");
const fixture = path.resolve(here, "../../fake-agent/fixtures/mock-tools-harness");
// Inside out/ (git-ignored), so the build resolves the shell's dependencies like the default one.
const out = path.join(shellDir, "out", "tools-mock");
const ANSWER = "Lima is clear.";

let s: Sandbox;
let app: ElectronApplication | undefined;
let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // `check`, the tools' build and a full app build before the app starts.
  test.setTimeout(300_000);
  execFileSync(process.execPath, [cli, "dev", "--build", out], { cwd: fixture, stdio: "inherit" });
  s = makeSandbox("tools-mock");
  // The fake engine replays the fixture's mock/ (HH_FAKE_MOCK_DIR), which also turns on the tools' recorded transport.
  const launched = await launchMock(s, path.join(fixture, "mock"), path.join(out, "main", "index.js"));
  app = launched.app;
  page = launched.page;
});

test.afterAll(async () => {
  try {
    if (app) await closeAndClean(app, s);
    else if (s) fs.rmSync(s.root, { recursive: true, force: true });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    // `dev` built the fixture's tools into its dist/ (git-ignored); leave the fixture as committed.
    fs.rmSync(path.join(fixture, "dist"), { recursive: true, force: true });
  }
});

test("a mock-mode run answers a tool from the recording", async () => {
  await expect(page.getByText("Test mode (no AI)")).toBeVisible();
  await page.getByRole("button", { name: "Start Mock Tools" }).click();
  await page.getByRole("button", { name: /Forecast/ }).first().click();
  await expect(page.getByRole("main").getByText(ANSWER)).toBeVisible({ timeout: 30_000 });

  // The pre-step ran for real, its fetch answered from mock/tools/weather/001.json.
  const group = page.locator(".hh-tool-group");
  await expect(group).toHaveCount(1);
  const button = group.getByRole("button").first();
  await expect(button).toHaveText(/^Prepared 1 item · /);
  await button.click();
  const pre = group.locator(".hh-tool-call");
  await expect(pre).toHaveCount(1);
  await pre.getByRole("button").click();
  await expect(pre.locator("dl").getByRole("term")).toHaveText(["Arguments", "Result", "Accesses"]);
  await expect(pre.locator("pre").nth(1)).toHaveText('{"city":"lima","sky":"clear"}');

  // The agent's first call (Lima) is answered from the same recording.
  const agent = page.locator(".hh-tool-calls > .hh-tool-call");
  await expect(agent).toHaveCount(2);
  await expect(agent.first()).not.toHaveClass(/hh-error/);
  await expect(agent.first().getByRole("button")).toHaveText(/^weather · /);
  await agent.first().getByRole("button").click();
  await expect(agent.first().locator("pre").first()).toHaveText('{"city":"lima"}');
  await expect(agent.first().locator("pre").nth(1)).toHaveText('{"city":"lima","sky":"clear"}');
  await expect(agent.first().getByRole("listitem")).toHaveText(["fetch https://api.weather.test/v1/lima"]);
});

test("an access with no recording fails 'Not recorded'", async () => {
  const oslo = page.locator(".hh-tool-calls > .hh-tool-call").nth(1);
  const button = oslo.getByRole("button");
  // A failed call starts open, without a click.
  await expect(oslo).toHaveClass(/hh-error/);
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveText(/^weather failed · .*Not recorded: GET https:\/\/api\.weather\.test\/v1\/oslo/);
  await expect(oslo.locator("pre").first()).toHaveText('{"city":"oslo"}');
  // The failed call doesn't end the turn (end follow-up M18): the recorded choices still play, and nothing failed.
  await expect(page.getByRole("button", { name: /Another city/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Something failed")).toHaveCount(0);
});

test("no key is asked or read", async () => {
  // Every key is fixture-<id> in mock mode: no Connections prompt, and the key store is never made.
  await expect(page.getByText(/Settings › Connections/)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The store is <shared>/<harness>/secrets (main's secretStore); userData is checked too, where the plan put it.
  const files = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []);
  expect(files(path.join(s.sharedDir, "mock-tools", "secrets"))).toEqual([]);
  expect(files(path.join(s.userData, "mock-tools", "secrets"))).toEqual([]);
});
