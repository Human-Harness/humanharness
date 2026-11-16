import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Task view one column, T7–T8: with a task open the conversation is one 680 column, centred; the guided path folds into a
// 280 overlay on the left (DESIGN.md §10.9). No side column, no Sidekick strip: the demo declares no Sidekick.
const START = "Which part do you want to understand?";

async function openTask(page: Page) {
  await page.getByRole("button", { name: "Start Demo" }).click();
  await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
  await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();
}

test("one 680 column at 1100×720; it fits 900×600 with no sideways scroll; the path is a folded overlay", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("task-column");
  const { app, page } = await launchMock(s);
  try {
    await page.setViewportSize({ width: 1100, height: 720 });
    await openTask(page);
    const card = page.locator(".hh-conversation");
    // Folded: no overlay open, no side column, no Sidekick strip or button.
    await expect(page.getByRole("complementary", { name: "Path" })).toHaveCount(0);
    await expect(page.locator("aside.hh-side, .hh-sk-rail, .hh-sk-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open Sidekick|Sidekick ·/ })).toHaveCount(0);
    expect((await card.boundingBox())!.width).toBeCloseTo(680, 0);
    // Plugin chips, when a plugin draws them, sit in a row above the conversation.
    const chips = page.locator(".hh-chips-row");
    if ((await chips.count()) > 0) expect((await chips.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y);

    // The path opens over the content, Escape folds it again and gives focus back to its button.
    const pathButton = page.getByRole("button", { name: /^Path · \d+ \/ \d+$/ });
    await pathButton.click();
    const overlay = page.getByRole("complementary", { name: "Path" });
    await expect(overlay).toBeVisible();
    expect((await overlay.boundingBox())!.width).toBeCloseTo(280, 0);
    await expect(overlay.getByRole("list", { name: "Guided path" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(pathButton).toBeFocused();

    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(200);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await closeAndClean(app, s);
  }
});
