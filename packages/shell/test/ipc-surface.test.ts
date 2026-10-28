import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.resolve(__dirname, "../src/main");

async function sources(): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const f of await fs.readdir(main, { recursive: true })) {
    if (!f.endsWith(".ts")) continue;
    out.push([f, await fs.readFile(path.join(main, f), "utf8")]);
  }
  return out;
}

/** B5: every app channel is registered through index.ts's handle(), which answers only the app's page. */
describe("the IPC surface (plugins spec B5)", () => {
  it("no ipcMain or webContents.ipc use outside handle() and the plugin channel", async () => {
    const uses: string[] = [];
    for (const [f, text] of await sources()) {
      for (const m of text.matchAll(/\b(ipcMain|\.ipc)\s*\.\s*(handle|handleOnce|on|once|addListener|prependListener|prependOnceListener)\(\s*("[^"]*"|[A-Za-z_.]+)/g)) {
        uses.push(`${f}:${m[3]}`);
      }
    }
    expect(uses.sort()).toEqual(["index.ts:channel", 'plugin-host.ts:"hh-plugin:rpc"']);
  });

  it("ipcMain is named only where those channels are registered", async () => {
    const named = (await sources()).filter(([, text]) => /\bipcMain\b/.test(text)).map(([f]) => f);
    expect(named.sort()).toEqual(["index.ts", "plugin-host.ts"]);
    // An alias (`const x = wc.ipc; x.on(…)`) would pass the test above: name `.ipc` only where it is allowed too.
    // plugin-host.ts registers on ipcMain, not on a webContents' own `.ipc`: nothing names `.ipc`.
    const ipc = (await sources()).filter(([, text]) => /\.ipc\b/.test(text)).map(([f]) => f);
    expect(ipc.sort()).toEqual([]);
  });
});
