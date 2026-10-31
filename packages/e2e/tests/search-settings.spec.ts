import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("⌘K: a setting opens Settings at the field; an action runs; nothing typed lists the actions", async () => {
  const s = makeSandbox("search-settings");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });

    await page.keyboard.press(`${MOD}+k`);
    await expect(dialog.getByRole("group", { name: "Actions" })).toBeVisible();
    await page.keyboard.type("appearance");
    await expect(dialog.getByRole("group", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Settings" });
    await expect(sheet.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet.locator('[data-setting="general.appearance"] :focus')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("history");
    await dialog.getByRole("option", { name: /Open History/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
