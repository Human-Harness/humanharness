import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { appHomeOf, closeAndClean, launch, makeSandbox } from "./helpers";

// Minimal-core 0c1: the mod kit an outside agent uses. A scripted MCP client (no AI) talks to `humanharness mcp`
// over stdio: it reads the catalog, makes the mod `greeting` and checks it; the person turns it on in Settings › Mods;
// the client clones the layout, places the block in its header, and sees the result through `status` and `shot`.
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../../cli/bin/humanharness.js");
/** The demo harness, as the shell's default build ships it. */
const harnessId = "demo";

const script: ClaudeScript = {
  steps: [
    ...claudeTextLines("Listo."),
    { line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session", usage: { input_tokens: 10, output_tokens: 1 } } },
  ],
};

/** Calls a tool and returns its result, failing the test on an error with the tool's message. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = r.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  expect(r.isError ?? false, `${name}: ${text}`).toBe(false);
  return r;
}
/** A tool's JSON answer. */
function json<T>(r: CallToolResult): T {
  const first = r.content[0];
  if (first?.type !== "text") throw new Error("expected a text answer");
  return JSON.parse(first.text) as T;
}

async function openMods(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Mods" }).click();
  return page.getByRole("tabpanel", { name: "Mods" });
}

test("an MCP client creates, checks, places and sees a mod through humanharness mcp", async () => {
  test.setTimeout(180_000);
  const s = makeSandbox("mod-kit");
  const { app, page } = await launch(s, { claude: script });
  const home = appHomeOf(s, harnessId);
  // Started before the app has written its home folder, `mcp --home` would find nothing to serve.
  await expect.poll(() => fs.existsSync(path.join(home, ".control.json")), { timeout: 30_000 }).toBe(true);
  const client = new Client({ name: "mod-kit-e2e", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--home", home], stderr: "inherit" }));
  try {

    // catalog: the core mod home is there.
    const cat = json<{ mods: { id: string; layer: string }[] }>(await call(client, "catalog"));
    expect(cat.mods).toContainEqual(expect.objectContaining({ id: "home", layer: "core" }));

    // mod_new, then mod_check passes.
    const made = json<{ id: string; block: string; path: string }>(
      await call(client, "mod_new", { id: "greeting", name: "Greeting", description: "Says hello at the top of the window." }),
    );
    expect(made).toMatchObject({ id: "greeting", block: "main", path: path.join(home, "mods", "greeting") });
    const checked = json<{ ok: boolean }>(await call(client, "mod_check", { folder: "mods/greeting" }));
    expect(checked.ok).toBe(true);

    // The person turns greeting on, through the local-mod warning.
    const tab = await openMods(page);
    const sw = tab.getByRole("switch", { name: "Greeting", exact: true });
    await expect(sw).not.toBeChecked({ timeout: 15_000 });
    await sw.click();
    await expect(tab.getByText(/full access to your folder/)).toBeVisible();
    await tab.getByRole("button", { name: "Turn on" }).click();
    await expect(tab.getByRole("switch", { name: "Greeting", exact: true })).toBeChecked();

    // layout_clone main mine; the block goes in mine's header; the person picks mine.
    await call(client, "layout_clone", { name: "main", as: "mine" });
    const minePath = path.join(home, "layouts", "mine.json");
    const mine = JSON.parse(fs.readFileSync(minePath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(minePath, `${JSON.stringify({ ...mine, header: { mod: "greeting", block: "main" } }, null, 2)}\n`);
    await tab.getByRole("combobox", { name: "Layout to show" }).click();
    await page.getByRole("option", { name: "mine · Yours" }).click();
    await expect(tab.getByRole("region", { name: "Layout" }).getByText("Showing mine, from your layouts.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("main", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByText("Edit ui.tsx to change this block.")).toBeVisible({ timeout: 15_000 });

    // status: greeting runs, mine is shown.
    const status = json<{ mods: { id: string; on: boolean; failed?: string; problem?: string }[]; layout: { name: string; problems: string[] } }>(
      await call(client, "status"),
    );
    const greeting = status.mods.find((m) => m.id === "greeting");
    expect(greeting).toMatchObject({ on: true });
    expect(greeting?.failed).toBeUndefined();
    expect(greeting?.problem).toBeUndefined();
    expect(status.layout).toMatchObject({ name: "mine", problems: [] });

    // shot: a PNG the size of the window.
    const shot = await call(client, "shot");
    const image = shot.content.find((c) => c.type === "image");
    if (image?.type !== "image") throw new Error("shot returned no image");
    expect(image.mimeType).toBe("image/png");
    const png = Buffer.from(image.data, "base64");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    // The window's content in device pixels: its size times the scale factor of the display it is on.
    const window = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const [width, height] = win.getContentSize() as [number, number];
      const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
      return { width: Math.round(width * scale), height: Math.round(height * scale) };
    });
    expect(size).toEqual(window);
  } finally {
    await client.close();
    await closeAndClean(app, s);
  }
});
