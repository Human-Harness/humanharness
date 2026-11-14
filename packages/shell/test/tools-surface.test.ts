import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.resolve(__dirname, "../src/main");
const read = (f: string) => fs.readFile(path.join(main, f), "utf8");

/** The text from `start` to the end of the first balanced group `opener` finds (as connections-surface.test.ts). */
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

const count = (text: string, re: RegExp) => [...text.matchAll(new RegExp(re.source, "g"))].length;

/** The `if (hasTools(harness)) { … }` blocks of a file, each from its `if` to its closing brace. */
function toolsBlocks(index: string): string[] {
  const out: string[] = [];
  let at = index.indexOf("if (hasTools(harness)) {");
  while (at >= 0) {
    out.push(group(index, at + "if (hasTools(harness)) ".length, /\{/));
    at = index.indexOf("if (hasTools(harness)) {", at + 1);
  }
  return out;
}

describe("tools surface (tools spec §4, §5; D0)", () => {
  it("D0: tools channels, scheme and host exist only under hasTools", async () => {
    const index = await read("index.ts");
    // app-lifecycle.ts, the main entry's start-up, builds them; index.ts only hands it a setter over toolsHost.
    const start = await read("app-lifecycle.ts");
    const blocks = toolsBlocks(start);
    expect(blocks.length).toBeGreaterThan(0);
    const inBlocks = blocks.join("\n");
    // The host, the IPC and the toolsHost itself: once each, inside a hasTools block.
    for (const re of [/createToolsHost\(/, /registerToolsIpc\(/, /new ToolHost\(/, /\bd\.toolsHost = /]) {
      expect(count(index, re), re.source).toBe(0);
      expect(count(start, re), re.source).toBe(1);
      expect(count(inBlocks, re), re.source).toBe(1);
    }
    expect([...index.matchAll(/\btoolsHost = /g)].map((m) => index.slice(m.index, m.index + 15))).toEqual(["toolsHost = v;\n"]);
    // The scheme: alone inside the block, or beside the plugins' only when the harness has tools.
    expect(count(index, /\bTOOL_SCHEME\b/)).toBe(0);
    expect(count(start, /\bTOOL_SCHEME\b/)).toBe(3); // the import, the plugins' call and the tools-only call
    expect(inBlocks).toContain("protocol.registerSchemesAsPrivileged([MOD_SCHEME, TOOL_SCHEME]);");
    expect(start).toContain("protocol.registerSchemesAsPrivileged(hasTools(harness) ? [MOD_SCHEME, PLUGIN_SCHEME, TOOL_SCHEME] : [MOD_SCHEME, PLUGIN_SCHEME]);");
    expect(count(index, /registerSchemesAsPrivileged\(/)).toBe(0);
    expect(count(start, /registerSchemesAsPrivileged\(/)).toBe(3); // and hh-mod alone when neither
    // toolsHost starts null and is set only there; everything else reads it through `toolsHost?.` or `toolsHost ?`.
    expect(index).toContain("let toolsHost: ToolsHost | null = null;");
    // index.ts never names a tools channel or the scheme in a string; only the tools/ files that own them do.
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts"))) {
      if ([path.join("tools", "tools-ipc.ts"), path.join("tools", "tool-host.ts"), path.join("tools", "tool-protocol.ts")].includes(f)) continue;
      expect(await read(f), f).not.toMatch(/["'`](hh:tools|hh-tools)/);
    }
  });

  it("AppState.tools only under hasTools; the workspace's tools option only from toolsHost", async () => {
    const index = await read("index.ts");
    // app-state.ts holds appState; index.ts passes it the tools host.
    const appState = await read("app-state.ts");
    const state = group(appState, appState.indexOf("async function appState(): Promise<AppState>"), /\{/);
    expect(state).toContain("...(d.toolsHost() ? { tools: d.toolsHost()!.info() } : {}),");
    expect(count(appState, /\btools: d\.toolsHost\(\)!\.info\(\)/)).toBe(1);
    expect(index).toMatch(/createAppState\(\{[^]*?\n  toolsHost: \(\) => toolsHost,\n/);
    const options = index.slice(index.indexOf("async function runtimeOptions("), index.indexOf("const runtime = memoise<HarnessRuntime>"));
    expect(options).toContain("const tools = await toolsHost?.workspaceOptions();");
    expect(options).toContain("...(tools ? { tools } : {}),");
    expect(count(index, /workspaceOptions\(\)/)).toBe(1);
  });

  it("Decision 7: the tools' Attention item goes only to the shared store (board and single mode; plain mode has none, D0)", async () => {
    // app-lifecycle.ts, the main entry's start-up, builds the stores and the tools host.
    const start = await read("app-lifecycle.ts");
    expect(start).toContain('if (hasTools(harness)) stores.registerKnown("tool", (id) => id === harness.id);');
    const deps = group(start, start.indexOf("d.toolsHost = createToolsHost("));
    // The dep exists only when the shared store does; it asks that store for the current base.
    expect(deps).toContain("...(d.sharedAttention\n        ? {\n            attention: async (create: boolean) => {");
    expect(deps).toContain("d.sharedAttention.forBase(base, create)");
  });
});
