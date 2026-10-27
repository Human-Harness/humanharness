import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { MOCK_SIDEKICK_MARKS } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, sessionOf, usageFile } from "./helpers";
import { sidekickScript, slowSidekickScript } from "./scripts";

// Sidekick's pre-send review end to end (sidekick spec §4.1, §10 slice 1), against fake-claude.

type Run = { argv: string[]; prompt: string };
type UsageLine = { phase?: string; process?: string; moment?: string; sidekick?: string };
/** Any Sidekick turn (pre-send or after the reply). */
const isSidekick = (r: Run) => Object.values(MOCK_SIDEKICK_MARKS).some((m) => r.prompt.startsWith(m));
/** Sidekick's pre-send turn only: the after-reply turn runs too (on by default), at its own pace. */
const isPreSend = (r: Run) => r.prompt.startsWith(MOCK_SIDEKICK_MARKS.pre);

/** Opens the demo and turns Sidekick on from the top bar; returns the composer. */
async function start(page: Page) {
  await page.getByRole("button", { name: "Start Demo" }).click();
  await page.getByRole("button", { name: "Sidekick is off. Turn it on" }).click();
  await expect(page.getByRole("button", { name: "Sidekick is on. Turn it off" })).toBeVisible();
  return page.getByRole("textbox").first();
}

test("D0: with Sidekick off a vague prompt goes straight out; no review, no session, no folder, no usage line", async () => {
  const s = makeSandbox("sidekick-off");
  const { app, page } = await launch(s, { claude: sidekickScript });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await expect(page.getByRole("button", { name: "Sidekick is off. Turn it on" })).toBeVisible();
    const box = page.getByRole("textbox").first();
    await box.fill("make it better");
    await box.press("Enter");
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();
    // The task's own turn is logged, so the absence of a Sidekick line below is meaningful.
    await expect.poll(() => readJsonl<UsageLine>(usageFile(s)).length).toBeGreaterThan(0);

    expect(readJsonl<Run>(s.claudePrompts).filter(isSidekick)).toEqual([]);
    expect(readJsonl<UsageLine>(usageFile(s)).filter((r) => r.phase === "sidekick" || r.process === "sidekick")).toEqual([]);
    expect(fs.existsSync(path.join(s.userData, "sidekick"))).toBe(false);
    await expect(page.getByRole("region", { name: "Before you send" })).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a vague prompt gets a card; Send suggested sends the rewrite; the turn is tagged in usage", async () => {
  const s = makeSandbox("sidekick-card");
  const { app, page } = await launch(s, { claude: sidekickScript });
  try {
    const box = await start(page);
    await box.fill("make it better");
    await box.press("Enter");
    const card = page.getByRole("region", { name: "Before you send" });
    await expect(card.getByText("Say which part should be better.")).toBeVisible();
    await card.getByRole("button", { name: "Send suggested" }).click();
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();

    const runs = readJsonl<Run>(s.claudePrompts);
    const sk = runs.filter(isPreSend);
    expect(sk).toHaveLength(1);
    // A no-tools session on the light tier (Claude's light default is haiku).
    expect(sk[0].argv).toContain("--tools");
    expect(sk[0].argv[sk[0].argv.indexOf("--model") + 1]).toBe("haiku");
    // Its working folder (the one the D0 test expects absent) lives in userData.
    expect(fs.existsSync(path.join(s.userData, "sidekick"))).toBe(true);
    expect(runs.filter((r) => !isSidekick(r)).map((r) => r.prompt)).toContainEqual(expect.stringContaining("Explain how the manifest declares actions"));
    await expect
      .poll(() => readJsonl<UsageLine>(usageFile(s)).filter((r) => r.phase === "sidekick" && r.moment === "pre"))
      .toEqual([expect.objectContaining({ process: "sidekick", moment: "pre", sidekick: "sidekick" })]);
    // The reply then gets its after-reply turn, tagged "after"; its "{}" shows no card.
    await expect
      .poll(() => readJsonl<UsageLine>(usageFile(s)).filter((r) => r.phase === "sidekick" && r.moment === "after"))
      .toEqual([expect.objectContaining({ process: "sidekick", moment: "after", sidekick: "sidekick" })]);
    await expect(page.getByRole("region", { name: "Before you send" })).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});

test("⌘⏎ / Ctrl⏎ sends at once with no review", async () => {
  const s = makeSandbox("sidekick-now");
  const { app, page } = await launch(s, { claude: sidekickScript });
  try {
    const box = await start(page);
    await box.fill("make it better");
    await box.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();
    expect(readJsonl<Run>(s.claudePrompts).filter(isPreSend)).toEqual([]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("a review that takes too long: the countdown, then the prompt goes as typed; the next review retries the same session", async () => {
  test.setTimeout(60_000);
  const s = makeSandbox("sidekick-timeout");
  const { app, page } = await launch(s, { claude: slowSidekickScript });
  try {
    const box = await start(page);
    await box.fill("make it better");
    await box.press("Enter");
    await expect(page.getByRole("button", { name: "Reviewing…" })).toBeVisible();
    await expect(page.getByText(/Sends anyway in \d+ s/)).toBeVisible();
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Sidekick took too long. Your prompt went as typed.")).toBeVisible();
    const sent = readJsonl<Run>(s.claudePrompts).filter((r) => !isSidekick(r));
    expect(sent.map((r) => r.prompt)).toContainEqual(expect.stringContaining("make it better"));

    // The next review retries the same Sidekick session.
    await box.fill("make it nicer");
    await box.press("Enter");
    await expect.poll(() => readJsonl<Run>(s.claudePrompts).filter(isPreSend).length, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => readJsonl<Run>(s.claudePrompts).filter((r) => !isSidekick(r)).length, { timeout: 15_000 }).toBe(2);
    const sk = readJsonl<Run>(s.claudePrompts).filter(isPreSend);
    expect(sessionOf(sk[1].argv)).toBe(sessionOf(sk[0].argv));
  } finally {
    await closeAndClean(app, s);
  }
});
