import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type ClaudeScript, claudeResultLine, claudeTextLines } from "@humanharness/fake-agent";
import { type Sandbox, closeAndClean, launch, launchMock, makeSandbox, readJsonl, usageFile } from "./helpers";

// Language on demand (plan 5b): the fake engine pseudo-translates each batch ("<prefix> <English>").
test.setTimeout(180_000);
const idle: ClaudeScript = { steps: [...claudeTextLines("ok"), claudeResultLine(true)] };
const init = { line: { type: "system", subtype: "init", session_id: "tr" } };
const translating = (prefix: string): ClaudeScript => ({
  ...idle,
  turns: [{ match: "<batch>", steps: [init, { pseudoTranslate: { prefix } }, claudeResultLine(true, "done", "tr")] }],
});
/** A translation turn that saves nothing and hangs until it is stopped. */
const hanging: ClaudeScript = { ...idle, turns: [{ match: "<batch>", steps: [init, { sleep: 120_000 }, claudeResultLine(true, "done", "tr")] }] };

const batchRuns = (s: Sandbox) => readJsonl<{ argv: string[]; prompt: string }>(s.claudePrompts).filter((r) => r.prompt.includes("<batch>"));
const savedConfig = (s: Sandbox) => JSON.parse(fs.readFileSync(path.join(s.userData, "config.json"), "utf8")) as Record<string, unknown>;

test("D0: an English app on an English system shows no offer, no new line and writes no locales", async () => {
  const s = makeSandbox("lang-d0", { language: "en", languageOffered: false });
  const { app, page } = await launch(s, { claude: idle }, undefined, {}, ["--lang=en"]);
  try {
    await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Change…" })).toBeVisible();
    await page.getByRole("tab", { name: "Engine" }).click();
    await expect(page.getByText(/this app is not responsible for what the AI writes/)).toBeVisible();
    await expect(page.getByText("Legal texts are shown in English.")).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("region", { name: /in another language/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    expect(fs.existsSync(path.join(s.userData, "locales"))).toBe(false);
    expect(batchRuns(s)).toEqual([]);
  } finally {
    await closeAndClean(app, s);
  }
});

test("the offer, the notice, the run in batches, the live switch; legal text stays English", async () => {
  const s = makeSandbox("lang-run", { languageOffered: false });
  const { app, page } = await launch(s, { claude: translating("[es]") });
  try {
    // The card shows once the engine check and the state load have answered.
    const card = page.getByRole("region", { name: "Use Demo in another language?" });
    await expect(card).toContainText("Suggested: Español");
    await card.getByRole("button", { name: "Choose language" }).click();
    const picker = page.getByRole("dialog", { name: "Language" });
    await expect(picker.getByRole("radio", { name: /Español/ })).toBeChecked();
    await picker.getByRole("button", { name: "Use" }).click();
    const notice = page.getByRole("alertdialog", { name: "Translate the app?" });
    await expect(notice).toContainText("Legal texts stay in English.");
    // Nothing went to the engine before Translate (D3).
    expect(batchRuns(s)).toEqual([]);
    await notice.getByRole("button", { name: "Translate" }).click();
    await expect(page.getByRole("button", { name: "[es] Start Demo" })).toBeVisible({ timeout: 150_000 });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("es");

    const runs = batchRuns(s);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0].prompt).toContain("into Spanish");
    expect(runs.some((r) => r.prompt.includes('"legal.'))).toBe(false);
    expect(runs[1].argv).toContain("--resume");
    const cache = JSON.parse(fs.readFileSync(path.join(s.userData, "locales", "es.json"), "utf8"));
    expect(cache.entries["core:chat.send"].value).toBe("[es] Send");
    expect(Object.keys(cache.entries).some((k) => k.startsWith("core:legal"))).toBe(false);
    const usage = readJsonl<{ phase?: string; language?: string }>(usageFile(s)).filter((r) => r.phase === "translate");
    expect(usage.length).toBe(runs.length);
    expect(usage.every((r) => r.language === "es")).toBe(true);
    expect(savedConfig(s)).toMatchObject({ language: "es", languageOffered: true });
    // The answered offer doesn't come back.
    await expect(page.getByRole("region", { name: /in another language/ })).toHaveCount(0);

    // Legal text stays English, with the line in the app's language.
    await page.getByRole("button", { name: "[es] Settings" }).click();
    await page.getByRole("tab", { name: "[es] Engine" }).click();
    await expect(page.getByText(/this app is not responsible for what the AI writes/)).toBeVisible();
    await expect(page.getByText("[es] Legal texts are shown in English.")).toBeVisible();

    // Back to English at once, no notice.
    await page.getByRole("tab", { name: "[es] General" }).click();
    await page.getByRole("button", { name: "[es] Change…" }).click();
    await page.getByRole("radio", { name: /English/ }).check();
    await page.getByRole("button", { name: "[es] Use" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
    await expect.poll(() => savedConfig(s).language).toBe("en");
  } finally {
    await closeAndClean(app, s);
  }
});

test("a failed run stays in the old screens, keeps the saved language, and offers Try again", async () => {
  const s = makeSandbox("lang-fail");
  const failing: ClaudeScript = { ...idle, turns: [{ match: "<batch>", steps: [{ line: { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" } }] }] };
  const { app, page } = await launch(s, { claude: failing });
  try {
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("The app's texts aren't in Español yet.")).toBeVisible();
    await page.getByRole("button", { name: "Translate" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Translate" }).click();
    await expect(page.getByText("The translation stopped. What it finished is kept.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
    expect(savedConfig(s).language).toBe("es");
    expect(await page.evaluate(() => document.documentElement.lang)).not.toBe("es");
  } finally {
    await closeAndClean(app, s);
  }
});

test("a cancelled run switches nothing, and a started run answers the Home offer", async () => {
  const s = makeSandbox("lang-cancel", { languageOffered: false });
  const { app, page } = await launch(s, { claude: hanging });
  try {
    const card = page.getByRole("region", { name: "Use Demo in another language?" });
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Translate" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Translate" }).click();
    await expect.poll(() => batchRuns(s).length, { timeout: 30_000 }).toBe(1);
    // The notice closes once the run started; Settings › General shows its progress.
    await expect(page.getByText(/^Translating… \d+ of \d+$/)).toBeVisible();
    // A started run saves the offer as answered, in the file and in the window.
    await expect.poll(() => savedConfig(s).languageOffered).toBe(true);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("The translation stopped. What it finished is kept.")).toBeVisible({ timeout: 30_000 });
    expect(savedConfig(s).language).toBe("es");
    expect(await page.evaluate(() => document.documentElement.lang)).not.toBe("es");
    expect(fs.existsSync(path.join(s.userData, "locales", "es.json"))).toBe(false);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
    await expect(card).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
  }
});

test("changing the engine stops a translation run", async () => {
  const s = makeSandbox("lang-engine");
  const { app, page } = await launch(s, { claude: hanging });
  try {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Translate" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Translate" }).click();
    await expect.poll(() => batchRuns(s).length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByText(/^Translating… \d+ of \d+$/)).toBeVisible();
    await page.getByRole("tab", { name: "Engine" }).click();
    await page.getByRole("button", { name: /Codex/ }).first().click();
    await page.getByRole("button", { name: "Use Codex" }).click();
    await expect.poll(() => savedConfig(s).engineId, { timeout: 30_000 }).toBe("codex");
    await page.getByRole("tab", { name: "General" }).click();
    await expect(page.getByText("The translation stopped. What it finished is kept.")).toBeVisible({ timeout: 30_000 });
    expect(batchRuns(s).length).toBe(1);
    expect(savedConfig(s).language).toBe("es");
  } finally {
    await closeAndClean(app, s);
  }
});

test("mock mode: no offer, the picker says why, and only English can be picked", async () => {
  const s = makeSandbox("lang-mock", { languageOffered: false });
  const { app, page } = await launchMock(s);
  try {
    await expect(page.getByRole("button", { name: "Start Demo" })).toBeVisible();
    await expect(page.getByRole("region", { name: /in another language/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Change…" }).click();
    const picker = page.getByRole("dialog", { name: "Language" });
    await expect(picker.getByText("Connect an AI engine to translate the app.")).toBeVisible();
    await expect(picker.getByRole("radio", { name: /Français/ })).toBeDisabled();
    await expect(picker.getByRole("radio", { name: /English/ })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Change…" })).toBeFocused();
    // The saved Español has no translation: the row says why it can't translate, and nothing ran.
    await expect(page.getByText("Connect an AI engine to translate the app.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Translate" })).toBeDisabled();
    expect(fs.existsSync(path.join(s.userData, "locales"))).toBe(false);
  } finally {
    await closeAndClean(app, s);
  }
});
