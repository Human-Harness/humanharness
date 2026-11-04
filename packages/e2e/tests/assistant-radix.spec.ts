import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";
import { claudeScript } from "./scripts";

// Radix + Impeccable stage 3b: the Assistant's frame (steps, body, action bar, the end) and its folder, profile,
// connect and interview steps. The engine step is stage 3c. Each screen is shot in light and dark next to look.spec's
// (gitignored) shots, for the critique rounds and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const fixtures = path.resolve(here, "../../fake-agent/fixtures");
const builds = {
  setup: { fixture: path.join(fixtures, "setup-harness"), out: path.join(shellDir, "out", "assistant-setup") },
  profiles: { fixture: path.join(fixtures, "profiles-harness"), out: path.join(shellDir, "out", "assistant-profiles") },
  secrets: { fixture: path.join(fixtures, "secrets-harness"), out: path.join(shellDir, "out", "assistant-secrets") },
};
const mainOf = (b: { out: string }) => path.join(b.out, "main", "index.js");

test.beforeAll(() => {
  for (const b of Object.values(builds)) {
    const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: b.fixture, HH_OUT_DIR: b.out };
    delete env.ELECTRON_RUN_AS_NODE;
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
  }
});
test.afterAll(() => {
  for (const b of Object.values(builds)) fs.rmSync(b.out, { recursive: true, force: true });
});

/** Both themes of the screen on show, plus a narrow window with no sideways scroll. */
async function shoot(page: Page, name: string, narrow = false) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(lookDir, `assistant-radix-${name}-${theme}.png`), fullPage: true });
  }
  if (!narrow) return;
  await page.setViewportSize({ width: 560, height: 800 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(lookDir, `assistant-radix-${name}-narrow.png`), fullPage: true });
}

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
const interview: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    // The closing turn first: its prompt names the task too.
    { match: "save_note", steps: [{ mcp: { server: "ui", tool: "save_note", args: { title: "About Sofi", summary: ["Wants to pass maths"], decisions: [], files: [], open: [] } } }, result] },
    {
      match: "# Task: conocerte",
      steps: [
        ...claudeTextLines("Hola, ¿cómo te llamás y qué querés aprender?"),
        { mcp: { server: "data", tool: "data_put", args: { collection: "profile", record: { name: "Sofi", goal: "Pass maths" } } } },
        result,
      ],
    },
  ],
};

test("the folder step, light and dark, and narrow", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("assistant-folder", { folder: "", engineId: "" });
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Set up Demo" }).click();
    await expect(page.getByRole("heading", { name: "Where should we keep your work?" })).toBeVisible();
    await shoot(page, "folder", true);
  } finally {
    await closeAndClean(app, s);
  }
});

test("the interview and a form step", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("assistant-interview");
  const { app, page } = await launch(s, { claude: interview }, mainOf(builds.setup));
  try {
    await page.getByRole("button", { name: "Set up Tutor" }).click();
    await expect(page.getByRole("heading", { name: "Get to know you" })).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Hola, ¿cómo te llamás y qué querés aprender?")).toBeVisible();
    await shoot(page, "interview");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "How the AI talks" })).toBeVisible();
    await shoot(page, "form", true);
  } finally {
    await closeAndClean(app, s);
  }
});

test("the profile step, a form and the end", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("assistant-profiles");
  const { app, page } = await launch(s, { claude: claudeScript }, mainOf(builds.profiles));
  try {
    await page.getByRole("button", { name: "Set up Family Tutor" }).click();
    await expect(page.getByRole("heading", { name: "Who's using Family Tutor?" })).toBeVisible();
    await shoot(page, "profile");
    await page.getByRole("textbox", { name: "Name" }).fill("Sofi");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your goal" })).toBeVisible();
    await page.getByRole("textbox").first().fill("Fractions");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    await shoot(page, "done", true);
  } finally {
    await closeAndClean(app, s);
  }
});

test("the connect step", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("assistant-connect");
  const { app, page } = await launch(s, { claude: claudeScript }, mainOf(builds.secrets), { HH_TEST_FAKE_SECRETS: "1" });
  try {
    await page.getByRole("button", { name: /^Set up / }).click();
    await expect(page.getByRole("heading", { name: "Connect Jira" })).toBeVisible();
    await shoot(page, "connect");
  } finally {
    await closeAndClean(app, s);
  }
});

/** The end of a step longer than the window: every scroller scrolled to its bottom, both themes. */
async function shootEnd(page: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("*")) if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(lookDir, `assistant-radix-${name}-end-${theme}.png`) });
  }
}

// Stage 3c: the engine step. The choice and its One last check; then the card of each missing step. A fake engine is
// always ready, so HH_TEST_ENGINE_PROBLEM makes it report the step; the legal notice is the real one.
test("the engine step: the choice and One last check, light and dark, and narrow", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("assistant-engine", { engineId: undefined });
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Set up Demo" }).click();
    const claude = page.getByRole("radiogroup", { name: "AI engines" }).getByRole("radio", { name: /Claude.*Connected/ });
    await expect(claude).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { name: "One last check" })).toBeVisible();
    await shoot(page, "engine", true);
    await shootEnd(page, "engine");
  } finally {
    await closeAndClean(app, s);
  }
});

test("the engine step: the legal notice", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("assistant-engine-notice", { engineId: undefined });
  fs.writeFileSync(path.join(s.sharedDir, "engines.json"), JSON.stringify({ version: 1, engines: {} }));
  const { app, page } = await launch(s, { claude: claudeScript });
  try {
    await page.getByRole("button", { name: "Set up Demo" }).click();
    await expect(page.getByRole("heading", { name: "Before using Claude" })).toBeVisible();
    await shoot(page, "engine-notice", true);
    await shootEnd(page, "engine-notice");
  } finally {
    await closeAndClean(app, s);
  }
});

for (const [problem, heading] of [
  ["not-installed", "Install Claude"],
  ["outdated", "Update Claude"],
  ["logged-out", "Sign in to Claude"],
] as const) {
  test(`the engine step: ${problem}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`assistant-engine-${problem}`, { engineId: undefined });
    const { app, page } = await launch(s, { claude: claudeScript }, shellDir, { HH_TEST_ENGINE_PROBLEM: problem });
    try {
      await page.getByRole("button", { name: "Set up Demo" }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await shoot(page, `engine-${problem}`, problem === "not-installed");
      await shootEnd(page, `engine-${problem}`);
    } finally {
      await closeAndClean(app, s);
    }
  });
}
