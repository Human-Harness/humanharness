import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { MOCK_SIDEKICK_MARKS } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, sessionOf, shellDir, usageFile } from "./helpers";
import { twoSidekicksScript } from "./scripts";

// Two sidekicks end to end (sidekick spec §2a, §6.3, §10 slice 4), against fake-claude: the default Sidekick reviews
// before sending, the harness's Guard preset speaks at the phase change. A fixture harness: the demo has no phases.

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/sidekick-harness");
type Run = { argv: string[]; prompt: string };
type UsageLine = { phase?: string; process?: string; moment?: string; sidekick?: string };
const isSidekick = (r: Run) => Object.values(MOCK_SIDEKICK_MARKS).some((m) => r.prompt.startsWith(m));
const isPreSend = (r: Run) => r.prompt.startsWith(MOCK_SIDEKICK_MARKS.pre);
const isGuard = (r: Run) => r.prompt.startsWith(MOCK_SIDEKICK_MARKS.phase);
/** The Sidekick usage lines of one moment (each moment runs at its own pace, so polls filter by it). */
const usageOf = (file: string, moment: string) => readJsonl<UsageLine>(file).filter((r) => r.phase === "sidekick" && r.moment === moment);

test("two sidekicks: Sidekick reviews before sending, a muted kind stays quiet, Guard speaks at the phase change", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("sidekick-many");
  const outDir = path.join(shellDir, "out", "sidekick-many");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const launched = await launch(s, { claude: twoSidekicksScript }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;
    await page.getByRole("button", { name: "Start Planner" }).click();
    await page.getByRole("button", { name: "Sidekick is off. Turn it on" }).click();
    await expect(page.getByRole("button", { name: "Sidekick is on. Turn it off" })).toBeVisible();

    // Adopt the harness's preset in Settings: the tab is named for several sidekicks from then on.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Sidekick" }).click();
    const tab = page.getByRole("tabpanel", { name: "Sidekick" });
    await tab.getByRole("region", { name: "Suggested by the harness" }).getByRole("button", { name: "Add Guard" }).click();
    await expect(page.getByRole("tab", { name: "Sidekicks" })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: /Report/ }).first().click();
    await expect(page.getByRole("main").getByText("Listo.").first()).toBeVisible();
    const box = page.getByRole("textbox").first();
    const panel = page.getByRole("complementary", { name: "Sidekick" });

    // Pre-send: the default Sidekick flags a vague prompt, named on the card now that there are two.
    await box.fill("make it better");
    await box.press("Enter");
    const card = panel.getByRole("region", { name: "Before you send" });
    await expect(card.getByText("Say which part should be better.")).toBeVisible();
    await expect(card.locator(".hh-sk-speaker")).toContainText("Sidekick");
    // "Don't flag" mutes the kind for Sidekick at once (spec §6.3).
    await card.getByRole("button", { name: "Don't flag “Vague words”" }).click();
    await expect(card).toHaveCount(0);

    // The next review runs without the muted kind: the vague word isn't flagged, the second ask is.
    await box.fill("make it better and also explain the sources");
    await box.press("Enter");
    await expect(card.getByText("Ask one thing at a time.")).toBeVisible();
    const reviews = readJsonl<Run>(s.claudePrompts).filter(isPreSend);
    expect(reviews.at(-1)!.prompt).toContain("\n- two-asks:");
    expect(reviews.at(-1)!.prompt).not.toContain("\n- vague:");
    // Its ask for later outlives the card once it is sent.
    const later = panel.getByText("For later");
    await expect(later).toBeVisible();
    await card.getByRole("button", { name: "Send anyway" }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => readJsonl<Run>(s.claudePrompts).filter((r) => !isSidekick(r)).map((r) => r.prompt)).toContainEqual(expect.stringContaining("make it better and also explain the sources"));
    await expect(later).toBeVisible();
    await expect(panel.getByText("Ask for the sources of claim 2")).toBeVisible();

    // Phase change: Guard speaks, named, in its own session.
    await page.getByRole("navigation", { name: "Task parts" }).getByRole("button", { name: "Writing" }).click();
    const guard = panel.getByRole("region", { name: "Before moving on" });
    await expect(guard.getByText("No agreed section list")).toBeVisible();
    await expect(guard.locator(".hh-sk-speaker")).toContainText("Guard");
    await expect.poll(() => usageOf(usageFile(s), "phase-change")).toEqual([expect.objectContaining({ process: "sidekick", moment: "phase-change", sidekick: "guard" })]);
    const runs = readJsonl<Run>(s.claudePrompts);
    const guardRuns = runs.filter(isGuard);
    expect(guardRuns).toHaveLength(1);
    expect(sessionOf(guardRuns[0].argv)).not.toBe(sessionOf(runs.filter(isPreSend)[0].argv));
    // Send anyway sends without another review; only Sidekick reviewed.
    expect(usageOf(usageFile(s), "pre").map((r) => r.sidekick)).toEqual(["sidekick", "sidekick"]);
  } finally {
    try {
      if (app) await closeAndClean(app, s);
      else fs.rmSync(s.root, { recursive: true, force: true });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});
