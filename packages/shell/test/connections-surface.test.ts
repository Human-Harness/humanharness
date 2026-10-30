import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.resolve(__dirname, "../src/main");
const read = (f: string) => fs.readFile(path.join(main, f), "utf8");

/** The text from `start` to the end of the first balanced group `opener` finds (as hatches-surface.test.ts). */
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

describe("connections surface (tools spec §9, D0)", () => {
  it("D0: connections channels are registered only under hasSecrets", async () => {
    const index = await read("index.ts");
    expect(count(index, /registerConnectionsIpc\(/)).toBe(1);
    expect(index).toContain("  if (hasSecrets(harness)) registerConnectionsIpc(handle, connections());\n");
    // The controller (and so the push) is built only there, or by a connect step's check, also under hasSecrets.
    expect(index).toContain("      ...(hasSecrets(harness) ? { secretsSet: (ids: readonly string[]) => connections().allSet(ids) } : {}),\n");
    expect(count(index, /\bconnections\(\)/)).toBe(3); // the definition and those two calls
    expect(count(index, /new ConnectionsController\(/)).toBe(1);
    const ctl = group(index, index.indexOf("function connections(): ConnectionsController"), /\{/);
    expect(count(ctl, /new ConnectionsController\(/)).toBe(1);
    // The window hears of a change on one channel, named only in the controller's deps.
    expect(count(index, /"hh:connections[A-Za-z]*"/)).toBe(1);
    expect(count(ctl, /"hh:connectionsChange"/)).toBe(1);
    // No other main file registers or names a connections channel (in a string; a comment may mention one).
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts"))) {
      if (f === "index.ts" || f === path.join("secrets", "connections-ipc.ts")) continue;
      expect(await read(f), f).not.toMatch(/["'`]hh:connections/);
    }
  });

  it("D0: the SecretStore is built only for plugins or secrets", async () => {
    const index = await read("index.ts");
    expect(count(index, /new SecretStore\(/)).toBe(1);
    const store = group(index, index.indexOf("function secretStore(): SecretStore | null"), /\{/);
    expect(store).toMatch(
      /^function secretStore\(\): SecretStore \| null \{\s*if \(!pluginsAccepted\(harness\) && \(hooks\.pluginDirs\?\.length \?\? 0\) === 0 && !hasSecrets\(harness\)\) return null;/,
    );
    expect(count(store, /new SecretStore\(/)).toBe(1);
    // Reached only through secretStore(): the plugins' controller, the connections' controller and the tools host
    // (built only under hasTools, tools-surface.test.ts).
    expect(count(index, /\bsecretStore\(\)/)).toBe(4); // the definition and those three
    // No other main file builds one.
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
      expect(await read(f), f).not.toMatch(/new SecretStore\(/);
    }
  });

  it("appState carries connections only when the harness declares secrets (D0)", async () => {
    const index = await read("index.ts");
    const state = group(index, index.indexOf("async function appState(): Promise<AppState>"), /\{/);
    expect(state).toContain("...(hasSecrets(harness) ? { connections: { count: harness.secrets!.length } } : {}),");
    expect(count(index, /\bconnections: \{ count:/)).toBe(1);
  });
});
