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

/** The text from `start` to the end of the first balanced group `opener` finds: the block a call or a function opens. */
function group(text: string, start: number, opener = /[({]/): string {
  if (start < 0) throw new Error("not found");
  const open = text.slice(start).search(opener) + start;
  const close = text[open] === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}

/** B9/P6: a prepared task starts only from the person's Start, through one channel that carries only a token. */
describe("the prepared task's one way in (plugins spec P6)", () => {
  it("startPrepared is called only in the hh:pluginsStartPrepared handler and the deps index.ts gives registerPluginsIpc", async () => {
    const all = await sources();
    const calling = all.filter(([, text]) => /\bstartPrepared\s*\(/.test(text)).map(([f]) => f);
    expect(calling.sort()).toEqual(["index.ts", "plugin-ipc.ts", "task-manager.ts"]);
    const text = (f: string) => all.find(([n]) => n === f)![1];
    const count = (t: string) => [...t.matchAll(/\bstartPrepared\s*\(/g)].length;

    const ipc = text("plugin-ipc.ts");
    const handler = group(ipc, ipc.indexOf('handle("hh:pluginsStartPrepared"'));
    expect(count(handler)).toBeGreaterThan(0);
    expect(count(ipc)).toBe(count(handler));

    const index = text("index.ts");
    const register = group(index, index.indexOf("registerPluginsIpc(handle, pluginsCtl"));
    expect(count(register)).toBe(1);
    expect(count(index)).toBe(1);
    // task-manager.ts only declares it.
    expect([...text("task-manager.ts").matchAll(/\bstartPrepared\s*\(/g)].length).toBe(1);
  });

  it("D0: index.ts installs panels only in createWindow's plugins block, through installPluginPanels", async () => {
    const index = (await sources()).find(([n]) => n === "index.ts")![1];
    expect(index).not.toMatch(/\.installPanels\s*\(/);
    expect([...index.matchAll(/\binstallPluginPanels\s*\(/g)].length).toBe(1);
    const create = group(index, index.indexOf("async function createWindow()"), /\{/);
    const at = create.indexOf("if (plugins) {");
    expect(at).toBeGreaterThan(0);
    expect(create.slice(0, create.indexOf("if (plugins) {"))).toMatch(/const plugins = pluginsCtl;\s*$/);
    expect(group(create, at, /\{/)).toMatch(/installPluginPanels\(win, pluginHost, plugins\)/);
  });

  it("profileFor passes a prepared task's tier on as the manifest tier", async () => {
    const index = (await sources()).find(([n]) => n === "index.ts")![1];
    const profileFor = group(index, index.indexOf("profileFor: async (action, floor, tier)"), /\{/);
    expect(profileFor).toMatch(/manifestTier: manifestTier\(harness, action, tier\)/);
  });
});
