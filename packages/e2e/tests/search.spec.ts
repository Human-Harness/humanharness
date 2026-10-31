import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox, usageFile } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("⌘K: groups, Enter opens a note's heading in the reader, ⌘Enter prepares a question, Esc gives focus back", async () => {
  const s = makeSandbox("search");
  fs.mkdirSync(path.join(s.folder, "docs"), { recursive: true });
  fs.writeFileSync(path.join(s.folder, "docs", "guide.md"), "# Guide\n\nIntro.\n\n## Setup\n\nInstall it.\n\n## Context window\n\nThe context window holds the turn.\n");
  fs.mkdirSync(path.join(s.folder, ".harness", "notes"), { recursive: true });
  fs.writeFileSync(path.join(s.folder, ".harness", "notes", "engines.md"), "---\ntitle: Engines\ndate: 2026-10-30\n---\n## Summary\n- Each engine has its own context limit.\n");
  fs.writeFileSync(path.join(s.folder, ".env"), "SECRET=never-shown-value\n");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    const composer = page.getByRole("textbox").last();
    await composer.focus();

    // D0: nothing was built before the first ⌘K.
    expect(fs.existsSync(path.join(s.userData, "search"))).toBe(false);

    await page.keyboard.press(`${MOD}+k`);
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("context");
    const list = dialog.getByRole("listbox", { name: "Results" });
    await expect(list.getByRole("group", { name: "Notes" })).toBeVisible();
    await expect(list.getByRole("group", { name: "Files" })).toBeVisible();
    await expect(dialog).not.toContainText("never-shown-value");
    await expect(dialog).not.toContainText(".env");

    // Enter on the file: the reader at the heading above the match.
    const file = list.getByRole("option", { name: /guide\.md/ });
    await file.hover();
    await page.keyboard.press("Enter");
    const reader = page.getByRole("complementary", { name: "Document" });
    await expect(reader.getByRole("heading", { name: "Context window" })).toBeInViewport();
    await expect(dialog).toBeHidden();

    // ⌘Enter: the composer gets the query and its hints; nothing is sent.
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.type("context");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(dialog).toBeHidden();
    await expect(composer).toHaveValue(/^context\n\nPossibly related: /);
    expect(fs.existsSync(usageFile(s))).toBe(false);

    // Esc gives focus back to what had it.
    await composer.focus();
    await page.keyboard.press(`${MOD}+k`);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(composer).toBeFocused();
  } finally {
    await closeAndClean(app, s);
  }
});
