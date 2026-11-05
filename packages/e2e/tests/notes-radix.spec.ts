import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Radix + Impeccable stage 4b2: Files › Notes as a secondary page, a note's detail in the same column (DESIGN.md
// "Secondary pages"). The screenshots go next to look.spec's (gitignored) for the critique round and the PR.
const here = path.dirname(fileURLToPath(import.meta.url));
const lookDir = path.resolve(here, "..", "test-results", "look");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(lookDir, `${name}.png`), fullPage: true });
const note = (title: string, date: string, points: string[]) => `---\ntitle: ${title}\ndate: ${date}\n---\n## Summary\n${points.map((p) => `- ${p}`).join("\n")}\n`;

for (const theme of ["light", "dark"] as const) {
  test(`the Files page with its notes and a note's detail with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`notes-radix-${theme}`);
    const notes = path.join(s.folder, ".harness", "notes");
    fs.mkdirSync(notes, { recursive: true });
    fs.writeFileSync(
      path.join(notes, "engines.md"),
      note("Engines", "2026-10-30", ["Each engine has its own context limit.", "Switching engines keeps the notes.", "The test engine never spends tokens."]),
    );
    fs.writeFileSync(path.join(notes, "manifest.md"), note("The manifest", "2026-10-28", ["defineHarness validates the manifest.", "Actions bring their brief."]));
    const { app, page } = await launchMock(s);
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.getByRole("button", { name: "Start Demo" }).click();
      const rail = page.getByRole("navigation", { name: "App" });

      // The rail's Files: its own page, the h1 focused, the entry selected, Back to the task in the top bar.
      await rail.getByRole("button", { name: "Files" }).click();
      const files = page.getByRole("region", { name: "Files", exact: true });
      await expect(files.getByRole("heading", { level: 1, name: "Files" })).toBeFocused();
      await expect(rail.getByRole("button", { name: "Files" })).toHaveAttribute("aria-current", "page");
      const list = files.getByRole("region", { name: "Notes" });
      await expect(list).toContainText("2 topics summarized");
      await shot(page, `notes-page-radix-${theme}`);
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(300);
      await shot(page, `notes-page-radix-${theme}-narrow`);
      await page.setViewportSize({ width: 1280, height: 900 });

      // A note's detail in the same column; Back says "Notes".
      await list.getByRole("button", { name: /Engines/ }).click();
      const detail = page.getByRole("region", { name: "Engines", exact: true });
      await expect(detail.getByRole("heading", { level: 1, name: "Engines" })).toBeFocused();
      await expect(detail).toContainText("Switching engines keeps the notes.");
      const back = page.locator(".hh-shell header.hh-topbar").getByRole("button", { name: "Back to Notes" });
      await expect(back).toBeVisible();
      await shot(page, `notes-detail-radix-${theme}`);

      // Escape goes to the list with the focus on the note's row, then back to the task.
      await page.keyboard.press("Escape");
      await expect(list.getByRole("button", { name: /Engines/ })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(files).toBeHidden();
      await expect(rail.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    } finally {
      await closeAndClean(app, s);
    }
  });
}
