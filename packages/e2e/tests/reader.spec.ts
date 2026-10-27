import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

/** A recording of the demo's manifest topic that writes two documents, then rewrites one. */
const readerMock = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/reader-mock");
const START = "Which part do you want to understand?";
const COMPOSER = "Ask about this topic…";

test("a turn's document: card, reader, contents, full screen, a .md link, live reload", async () => {
  const s = makeSandbox("reader");
  const { app, page } = await launchMock(s, readerMock);
  // The Mermaid diagram draws under the app's CSP: no violation may show in the console.
  const csp: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text());
  });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();

    // The card opens the reader.
    const card = page.getByRole("button", { name: /Manifest overview/ }).first();
    await expect(card).toContainText("New");
    await page.getByRole("button", { name: /Decisions/ }).waitFor();
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    await expect(reader.getByRole("heading", { level: 1, name: "Manifest overview" })).toBeVisible();
    await expect(reader.locator(".hh-callout-summary")).toBeVisible();
    await expect(reader.locator(".hh-md-caption")).toHaveText("What a harness declares");
    await expect(reader.locator(".hh-md-diagram img")).toBeVisible();
    expect(csp).toEqual([]);

    // The table of contents shows at the default window size, and jumps.
    await reader.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Risks" }).click();
    await expect(reader.getByRole("heading", { name: "Risks" })).toBeInViewport();

    // Full screen and back. In the narrowest window the contents show only in full screen.
    const contents = reader.getByRole("navigation", { name: "Contents" });
    const resize = (width: number) => app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 720), width);
    await resize(900);
    await expect(contents).toBeHidden();
    await reader.getByRole("button", { name: "Full screen" }).click();
    await expect(page.getByPlaceholder(COMPOSER)).toBeHidden();
    await expect(contents).toBeVisible();
    await reader.getByRole("button", { name: "Show chat" }).click();
    await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();
    await expect(contents).toBeHidden();
    await resize(1100);
    await expect(contents).toBeVisible();

    // Closing from full screen gives focus back to the card that opened the reader, once the chat shows again.
    await reader.getByRole("button", { name: "Full screen" }).click();
    await reader.getByRole("button", { name: "Close" }).click();
    await expect(reader).toHaveCount(0);
    await expect(card).toBeFocused();
    await card.click();

    // A .md link between documents, at its anchor.
    await reader.getByRole("link", { name: "decisions" }).click();
    await expect(reader.getByRole("heading", { name: "Why" })).toBeVisible();

    // Live reload: the agent rewrites the open document.
    await card.click();
    await expect(reader.getByRole("heading", { name: "Context" })).toBeVisible();
    await page.getByPlaceholder(COMPOSER).fill("Add a section on blocks.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(reader.getByRole("heading", { name: "Blocks" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Manifest overview.*Updated/ })).toBeVisible();
    expect(csp).toEqual([]);
  } finally {
    await closeAndClean(app, s);
  }
});
