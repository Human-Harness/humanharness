import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox, shellDir } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../fake-agent/fixtures/review-harness");
/** The demo (edit "none") with a recording whose second turn calls ask_in_document. */
const d0Mock = path.resolve(here, "../fixtures/review-d0-mock");
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const readRecord = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "reviews", "specs", "filter.md.json"), "utf8"));

/** A full app build of the fixture (electron-vite directly: `humanharness dev --build` would first run `check`). */
function build(outDir: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
}

/** Starts the ticket: the agent writes specs/filter.md and asks two questions in it. */
async function startTicket(page: Page) {
  await page.getByRole("button", { name: "Start Reviewer" }).click();
  await page.getByRole("button", { name: /Ticket/ }).first().click();
  await expect(page.getByRole("button", { name: /Filter/ }).first()).toContainText("2 questions open", { timeout: 30_000 });
}

const outDir = path.join(shellDir, "out", "review");
const mainJs = path.join(outDir, "main", "index.js");
// One build of the fixture for both of its tests.
test.beforeAll(() => {
  test.setTimeout(300_000);
  build(outDir);
});
test.afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

test("review a spec: answer, comment, send, focus, approve, the part moves on, stale after a change", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("review");
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchMock(s, path.join(fixture, "mock"), mainJs);
    app = launched.app;
    const page = launched.page;
    const csp: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text());
    });
    await startTicket(page);

    // The card carries the review chip; it opens the reader with the Comments column.
    const card = page.getByRole("button", { name: /Filter/ }).first();
    await expect(card).toContainText("1 blocking");
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    const column = reader.getByRole("region", { name: "Comments" });
    // The document's own text (the cards quote it too).
    const text = reader.locator(".hh-review-text");
    await expect(column.locator("article")).toHaveCount(2);

    // An answer swaps the passage at once, with no turn.
    await column.getByRole("radio", { name: "Size and colour" }).click();
    await expect(text.getByText("Filter by size and colour.")).toBeVisible();
    await expect.poll(() => fs.readFileSync(path.join(s.folder, "specs", "filter.md"), "utf8")).toContain("Filter by size and colour.");

    // "Other…" on the second question: kept for the round, the text stays.
    await column.getByRole("button", { name: "Other…" }).nth(1).click();
    await column.getByRole("textbox", { name: "Your answer" }).fill("Newest first");
    await column.getByRole("button", { name: "Save answer" }).click();
    await expect(text.getByText("Results keep their order.")).toBeVisible();

    // A comment on a selected paragraph.
    await text.getByText("The list loads at once.").click({ clickCount: 3 });
    await reader.getByRole("button", { name: "Comment", exact: true }).click();
    await reader.getByRole("textbox", { name: "Your comment" }).fill("Load in pages.");
    await reader.getByRole("button", { name: "Save draft" }).click();
    await expect(column.locator("article")).toHaveCount(3);

    // One round carries the comment and the Other answer; the agent edits and replies.
    await reader.getByRole("button", { name: "Send comments (2)" }).click();
    await expect(text.getByText("The list loads in pages of 50.")).toBeVisible({ timeout: 30_000 });
    await expect(column.getByText("Pages of 50.")).toBeVisible();
    await expect.poll(() => readTasks(s.folder).current?.status, { timeout: 30_000 }).toBe("waiting");

    // Focus mode: only the document. The blocking question has an answer, so approving needs no reason.
    await reader.getByRole("button", { name: "Focus" }).click();
    await expect(page.locator(".hh-body.hh-focus")).toHaveCount(1);
    await reader.getByRole("button", { name: /^Approve/ }).click();
    await expect(reader.getByText(/^Approved · /)).toBeVisible();
    expect(readRecord(s.folder).approvals).toHaveLength(1);

    // The spec part ended: the task moved to Plan on its own, by the person, and its turn ended while in focus.
    await expect.poll(() => readTasks(s.folder).current?.phase?.id, { timeout: 30_000 }).toBe("plan");
    expect(readTasks(s.folder).current.phases.at(-1)).toMatchObject({ id: "plan", by: "person" });
    await expect.poll(() => readTasks(s.folder).current?.status, { timeout: 30_000 }).toBe("waiting");
    await expect(page.locator(".hh-focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".hh-focus")).toHaveCount(0);
    // The turn that ended while in focus is counted: the summary names the waiting task.
    await expect(page.getByText(/^While you were reading: /).first()).toContainText("the task is waiting for you");
    // The mock answered the phase change, notice line and all.
    await expect(page.getByRole("main").getByText("Plan: one step per filter.")).toBeVisible();

    // A change after approval: stale, and "See what changed" shows the diff.
    fs.appendFileSync(path.join(s.folder, "specs", "filter.md"), "\nOne more line.\n");
    await reader.getByRole("button", { name: "Close" }).click();
    await card.click();
    await expect(reader.getByText("Changed since approval")).toBeVisible();
    await reader.getByRole("button", { name: "See what changed" }).click();
    await expect(reader.getByRole("region", { name: "Changes since the approval" })).toContainText("One more line.");

    expect(csp).toEqual([]);
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("approve anyway, with a reason, while a blocking question is open", async () => {
  test.setTimeout(120_000);
  const s = makeSandbox("review-reason");
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchMock(s, path.join(fixture, "mock"), mainJs);
    app = launched.app;
    const page = launched.page;
    await startTicket(page);
    const card = page.getByRole("button", { name: /Filter/ }).first();
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    await reader.getByRole("button", { name: "Approve · 1 blocking open" }).click();
    await reader.getByRole("button", { name: "Approve anyway, with a reason" }).click();
    await reader.getByRole("textbox", { name: "Why approve with blocking questions open?" }).fill("Decided on the call");
    await reader.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(reader.getByText(/^Approved · /)).toBeVisible();
    expect(readRecord(s.folder).approvals.at(-1).reason).toBe("Decided on the call");
    await expect.poll(() => readTasks(s.folder).current?.phase?.id, { timeout: 30_000 }).toBe("plan");
    expect(readTasks(s.folder).current.phases.at(-1)).toMatchObject({ id: "plan", by: "person" });
    await expect(card).toContainText("Approved");
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("a harness whose agent can't edit the folder (D0): no review in the reader, no review tools for the agent", async () => {
  const s = makeSandbox("review-d0");
  const { app, page } = await launchMock(s, d0Mock);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: "Which part do you want to understand?" }).getByRole("button", { name: /The manifest/ }).click();
    const card = page.getByRole("button", { name: /Manifest overview/ }).first();
    await expect(card).toContainText("New");
    await card.click();
    const reader = page.getByRole("complementary", { name: "Document" });
    await expect(reader.getByRole("heading", { level: 1, name: "Manifest overview" })).toBeVisible();
    await reader.getByText("The manifest declares the whole harness.").click({ clickCount: 3 });
    // None of the review controls: no column, no Comment, no footer bar, no Focus.
    await expect(reader.getByRole("region", { name: "Comments" })).toHaveCount(0);
    for (const name of ["Comment", "Approve", "Focus"]) await expect(reader.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: /^Send comment/ })).toHaveCount(0);
    await expect(reader.locator(".hh-reader-reviewing")).toHaveCount(0);
    await expect(card).not.toContainText(/question|blocking|In review|Approved/);

    // The ui server has no ask_in_document: the recorded call fails the turn, and no review record exists.
    await page.getByPlaceholder("Ask about this topic…").fill("Ask me about it.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByText("Something failed and I didn't change anything.")).toBeVisible({ timeout: 30_000 });
    expect(fs.existsSync(path.join(s.folder, ".harness", "reviews"))).toBe(false);
  } finally {
    await closeAndClean(app, s);
  }
});
