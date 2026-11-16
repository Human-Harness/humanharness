import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { appHomeOf, closeAndClean, launch, makeSandbox } from "./helpers";

// Minimal-core 0c1: the mod kit for outside agents. A scripted MCP client (no AI) drives `humanharness mcp --home
// <app home>` as an agent would: catalog, mod_new, mod_check; the person turns the mod on through the warning; the
// agent clones the layout and places the block, the person picks it; status and shot see the result. Nothing in the
// window is new, so there are no screenshots to review.
const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../../cli/bin/humanharness.js");
/** The demo harness, as the shell's default build ships it. */
const harnessId = "demo";

const script: ClaudeScript = {
  steps: [
    ...claudeTextLines("Listo."),
    { line: { type: "result", subtype: "success", is_error: false, result: "", session_id: "fake-session", usage: { input_tokens: 10, output_tokens: 1 } } },
  ],
};

type Content = { type: string; text?: string; data?: string; mimeType?: string }[];

/** Calls a tool; fails the test on an error answer. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Content> {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as Content;
  expect(r.isError === true, `${name}: ${content[0]?.text ?? ""}`).toBe(false);
  return content;
}
const json = <T>(content: Content) => JSON.parse(content[0]?.text ?? "null") as T;

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function pickLayout(page: Page, tab: Locator, name: string) {
  await tab.getByRole("combobox", { name: "Layout to show" }).click();
  await page.getByRole("option", { name }).click();
}

test("an agent with only the MCP server makes a mod that passes check and shows in a layout", async () => {
  test.setTimeout(240_000);
  const s = makeSandbox("mod-kit");
  const home = appHomeOf(s, harnessId);
  const { app, page } = await launch(s, { claude: script });
  // The app writes the home folder's layers on start; the server needs them.
  await expect.poll(() => fs.existsSync(path.join(home, ".control.json")), { timeout: 30_000 }).toBe(true);
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RUN_AS_NODE"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--home", home], env, stderr: "inherit" });
  const client = new Client({ name: "mod-kit-e2e", version: "0.0.0" });
  try {
    await client.connect(transport);

    // catalog: the core mod `home` is there.
    const catalog = json<{ mods: { id: string; layer: string }[] }>(await call(client, "catalog"));
    expect(catalog.mods.find((m) => m.id === "home")?.layer).toBe("core");

    // mod_new, then mod_check: every check ok.
    await call(client, "mod_new", { id: "greeting", name: "Greeting", description: "Says hello at the top of the app." });
    expect(fs.existsSync(path.join(home, "mods", "greeting", "mod.json"))).toBe(true);
    const checks = json<{ ok: boolean; checks: { ok: boolean }[] }>(await call(client, "mod_check", { folder: "mods/greeting" }));
    expect(checks.ok, JSON.stringify(checks)).toBe(true);

    // The person turns it on in Settings › Mods, through the warning.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Mods" }).click();
    const tab = page.getByRole("tabpanel", { name: "Mods" });
    const sw = tab.getByRole("switch", { name: "Greeting", exact: true });
    await expect(sw).not.toBeChecked({ timeout: 15_000 });
    await sw.click();
    await expect(tab.getByText(/full access to your folder/)).toBeVisible();
    await tab.getByRole("button", { name: "Turn on" }).click();
    await expect(tab.getByRole("switch", { name: "Greeting", exact: true })).toBeChecked();

    // layout_clone main mine; the agent places the block in the root stack's header; the person picks `mine`.
    await call(client, "layout_clone", { name: "main", as: "mine" });
    const mineFile = path.join(home, "layouts", "mine.json");
    const mine = JSON.parse(fs.readFileSync(mineFile, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(mineFile, `${JSON.stringify({ ...mine, header: { mod: "greeting", block: "main" } }, null, 2)}\n`);
    await pickLayout(page, tab, "mine · Yours");
    await expect(tab.getByRole("region", { name: "Layout" }).getByText("Showing mine, from your layouts.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("main", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Greeting" })).toBeVisible({ timeout: 15_000 });

    // status: greeting runs, mine is shown.
    const status = json<{ mods: { id: string; on: boolean; problem?: string; failed?: string }[]; layout: { name: string; source: string } }>(
      await call(client, "status"),
    );
    const greeting = status.mods.find((m) => m.id === "greeting");
    expect(greeting).toMatchObject({ on: true });
    expect(greeting?.problem).toBeUndefined();
    expect(greeting?.failed).toBeUndefined();
    expect(status.layout.name).toBe("mine");

    // shot: a PNG image the size of the window, and the path it saved.
    const content = await call(client, "shot");
    const image = content.find((c) => c.type === "image");
    expect(image?.mimeType).toBe("image/png");
    const png = Buffer.from(image?.data ?? "", "base64");
    const saved = content.find((c) => c.type === "text")?.text ?? "";
    expect(fs.readFileSync(saved).equals(png)).toBe(true);
    const win = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      const [width, height] = w.getContentSize();
      return { width: width!, height: height!, scale: screen.getDisplayMatching(w.getBounds()).scaleFactor };
    });
    const size = pngSize(png);
    expect([size.width / win.width, size.height / win.height]).toEqual([win.scale, win.scale]);
  } finally {
    await client.close();
    await closeAndClean(app, s);
  }
});
