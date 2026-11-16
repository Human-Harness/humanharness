import { expect, type Page, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl } from "./helpers";

// The composer and the turn's one working line (task view one column): Enter sends, Shift+Enter adds a line, there
// is no Send button; a running turn shows "Working · <step>" with Stop; scrolled up, the jump pill brings the end back.

type Run = { argv: string[]; prompt: string };
const result = { line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session" } };
const event = (e: unknown) => ({ line: { type: "stream_event", parent_tool_use_id: null, session_id: "fake-session", event: e } });
const delta = (text: string) => event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const LONG = Array.from({ length: 60 }, (_, i) => `Párrafo ${i + 1} de una respuesta larga.`).join("\n\n");

const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      // A slow turn: it reads a file and then waits, so Stop has something to end.
      match: "lento",
      steps: [
        { line: { type: "system", subtype: "init", session_id: "fake-session" } },
        { line: { type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "notes.md" } }] } } },
        { sleep: 30_000 },
        result,
      ],
    },
    {
      // A long answer that keeps going for a while: the reader scrolls up while it streams.
      match: "largo",
      steps: [
        ...claudeTextLines(LONG).slice(0, 3),
        { sleep: 8_000 },
        delta("\n\nFin de la respuesta larga."),
        event({ type: "content_block_stop", index: 0 }),
        result,
      ],
    },
  ],
};

const box = (page: Page) => page.getByPlaceholder("Or ask something…");
const conversation = (page: Page) => page.getByRole("region", { name: "Conversation" });
const workingLine = (page: Page) => page.locator(".hh-working-line");

test("Enter sends, Shift+Enter adds a line, and there is no Send button", async () => {
  const s = makeSandbox("composer-enter");
  const { app, page } = await launch(s, { claude: script });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await expect(box(page)).toBeVisible();
    await expect(page.locator("form.hh-composer").getByRole("button", { name: "Send" })).toHaveCount(0);
    await expect(page.locator("form.hh-composer")).toContainText("↵ send · ⇧↵ new line");

    await box(page).fill("uno");
    await box(page).press("Shift+Enter");
    await box(page).pressSequentially("dos");
    await expect(box(page)).toHaveValue("uno\ndos");
    expect(readJsonl<Run>(s.claudePrompts)).toEqual([]);

    await box(page).press("Enter");
    await expect(page.getByRole("main").getByText("Listo.")).toBeVisible();
    expect(readJsonl<Run>(s.claudePrompts).some((r) => r.prompt.includes("uno\ndos"))).toBe(true);
    await expect(page.locator("form.hh-composer textarea")).toHaveValue("");
  } finally {
    await closeAndClean(app, s);
  }
});

test("a running turn shows one working line with its step; Stop ends it and the line goes", async () => {
  const s = makeSandbox("composer-stop");
  const { app, page } = await launch(s, { claude: script });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await box(page).fill("algo lento");
    await box(page).press("Enter");
    await expect(workingLine(page)).toHaveCount(1);
    await expect(workingLine(page).getByRole("status")).toHaveText(/^Working · .*notes\.md/);
    // The bar's status is the only other place that says so; nothing in the chat says "Working…".
    await expect(conversation(page).getByText("Working…")).toHaveCount(0);

    await workingLine(page).getByRole("button", { name: "Stop" }).click();
    await expect(workingLine(page)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await closeAndClean(app, s);
  }
});

test("scrolled up during a long answer, the pill says what is new; a click goes to the end and hides it", async () => {
  const s = makeSandbox("composer-pill");
  const { app, page } = await launch(s, { claude: script });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await box(page).fill("algo largo");
    await box(page).press("Enter");
    await expect(workingLine(page)).toHaveCount(1);
    await expect(conversation(page).getByText("Párrafo 20 de una respuesta larga.")).toBeAttached();

    // The reader goes back up while the answer still runs.
    await conversation(page).evaluate((el) => {
      el.scrollTop = 100;
    });
    await expect(workingLine(page)).toHaveCount(0, { timeout: 20_000 });

    const pill = page.getByRole("button", { name: "1 new message ↓" });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(pill).toHaveCount(0);
    await expect
      .poll(() => conversation(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(80);
  } finally {
    await closeAndClean(app, s);
  }
});
