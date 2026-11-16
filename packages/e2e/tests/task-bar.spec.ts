import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

// Task view one column, T6: with a task open the top bar is the task's one bar (DESIGN.md §10), and the rail's TASK
// group opens the task's Notes, History and Task settings.
const START = "Which part do you want to understand?";

test("one bar with the switcher and the context chip; the rail's TASK group opens its pages", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("task-bar");
  // A note of the manifest's task: the rail's Notes lists it while that task is open.
  const notes = path.join(s.folder, ".harness", "notes");
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(path.join(notes, "manifest.md"), "---\ntitle: Manifest basics\ndate: 2026-10-28\naction: manifest\n---\n## Summary\n- defineHarness validates it.\n");
  const { app, page } = await launchMock(s);
  try {
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.getByRole("button", { name: "Start Demo" }).click();
    const rail = page.getByRole("navigation", { name: "App" });
    // No task open yet: no TASK group.
    await expect(rail.getByRole("button", { name: "Task settings" })).toHaveCount(0);
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();

    // One bar: the title once, as the switcher; no second header, no ⋯, no gear.
    const bar = page.locator(".hh-shell header.hh-topbar");
    const switcher = bar.getByRole("button", { name: "The manifest" });
    await expect(switcher).toHaveAttribute("aria-haspopup", "menu");
    await expect(page.getByRole("heading", { name: "The manifest" })).toHaveCount(0);
    await expect(page.locator(".hh-task-head")).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "More" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Settings" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: /^Context \d+%$/ })).toBeVisible();

    // The switcher lists the task; the demo runs one task at a time, so New task is parallel.spec's (D0).
    await switcher.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: /The manifest/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "New task" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // The rail's TASK group: each entry a full page under the same bar; Tasks goes back to the conversation.
    await rail.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("region", { name: "History", exact: true })).toBeVisible();
    await expect(switcher).toBeVisible();
    await rail.getByRole("button", { name: /^Notes/ }).click();
    await expect(page.getByRole("region", { name: "History", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: /^Notes/ })).toHaveAttribute("aria-current", "page");
    // The page says the name of the entry that opened it: the task's Notes, not Files.
    await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
    await expect(switcher).toBeVisible();
    // A note open on that page: Tasks still goes back to the conversation, not to the list.
    await page.getByRole("button", { name: /Manifest basics/ }).click();
    await expect(page.getByRole("region", { name: "Manifest basics", exact: true })).toBeVisible();
    await rail.getByRole("button", { name: "Tasks" }).click();
    await expect(page.getByRole("region", { name: "Manifest basics", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Files", exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByText(/El manifiesto declara todo el harness/)).toBeVisible();
    await rail.getByRole("button", { name: "Task settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
