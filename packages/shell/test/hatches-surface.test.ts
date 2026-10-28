import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineHarness } from "@humanharness/harness-sdk";
import { hatchesState } from "../src/main/linked-ipc";

const main = path.resolve(__dirname, "../src/main");
const read = (f: string) => fs.readFile(path.join(main, f), "utf8");

/** The text from `start` to the end of the first balanced group `opener` finds (as ipc-surface.test.ts). */
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

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: false }, blocks: {}, author: "x",
  actions: { implement: { label: "Implement", prompt: "./prompts/implement.md", cost: "medium" as const } },
  scopes: { label: "Project", plural: "Projects" },
};

describe("hatches IPC surface (hatches D0)", () => {
  it("linked-folder channels are registered only under hasLinkedFolders (D0)", async () => {
    const index = await read("index.ts");
    expect(count(index, /registerLinkedIpc\(/)).toBe(1);
    expect(index).toContain("  if (hasLinkedFolders(harness)) registerLinkedIpc(handle, linkedIpcDeps());\n");
    // Its deps (and so the prune and the key) are built only there.
    expect(count(index, /\blinkedIpcDeps\(\)/)).toBe(2); // the definition and that one call
    // No other file registers them, and the channel names appear nowhere else in main.
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts"))) {
      const text = await read(f);
      if (f === "linked-ipc.ts") continue;
      expect(text, f).not.toMatch(/hh:scopeLinked|hh:scopeLinkFolder|hh:scopeUnlinkFolder|hh:scopeConfirmGit/);
    }
  });

  it("D0: the links' key, live set and the histories' prune are reached only from the hasLinkedFolders deps", async () => {
    const index = await read("index.ts");
    const deps = group(index, index.indexOf("function linkedIpcDeps(): LinkedIpcDeps"), /\{/);
    for (const name of [/\blinkedSigning\(/, /\blinkedSecret\(/, /\bpruneUnlinked\(/, /"linked-key"/, /"linked-live\.json"/]) {
      expect(count(index, name), String(name)).toBe(count(deps, name));
    }
    expect(count(deps, /\blinkedSigning\(/)).toBe(1);
    expect(count(deps, /\bpruneUnlinked\(/)).toBe(1);
    // The key and live-set files are named only in linked-ipc.ts, the key made by the same function as the other app keys.
    const ipc = await read("linked-ipc.ts");
    expect(ipc).toContain('sourceTagKey(path.join(userData, "linked-key"), create)');
    expect(ipc).toContain('new LiveLinks(path.join(userData, "linked-live.json"))');
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts") && f !== "linked-ipc.ts")) {
      expect(await read(f), f).not.toMatch(/linked-key|linked-live/);
    }
  });

  it("appState carries hatches only when a hatch is declared (D0)", async () => {
    const index = await read("index.ts");
    const state = group(index, index.indexOf("async function appState(): Promise<AppState>"), /\{/);
    expect(state).toContain("const hatches = hatchesState(harness);");
    expect(state).toContain("...(hatches ? { hatches } : {}),");
    expect(hatchesState(defineHarness(base))).toBeUndefined();
    expect(hatchesState(defineHarness({ ...base, linkedFolders: {} }))).toBeUndefined();
    expect(hatchesState(defineHarness({ ...base, linkedFolders: { repos: { label: "Repos", mode: "write" } } }))).toEqual({
      linkedFolders: { repos: { label: "Repos", mode: "write", history: "auto", many: false } },
    });
  });

  it("the window's scope list never carries links (only signed ones, through hh:scopeLinked)", async () => {
    const index = await read("index.ts");
    const view = group(index, index.indexOf("async function scopesView(): Promise<ScopesView>"), /\{/);
    expect(view).toContain(".map(({ linked: _linked, ...s }) => s)");
  });

  it("D0: turns, AGENTS.md, histories and jobs reach linked folders only through the registered deps", async () => {
    const index = await read("index.ts");
    // The deps are made only by linkedIpcDeps (called only under hasLinkedFolders); linked_ answers null without them.
    expect(count(index, /\blinkedDeps = /)).toBe(1);
    expect(group(index, index.indexOf("function linkedIpcDeps(): LinkedIpcDeps"), /\{/)).toContain("linkedDeps = {");
    const parts = group(index, index.indexOf("function linked_()"), /\{/);
    expect(parts).toContain("if (linkedParts || !linkedDeps) return linkedParts;");
    expect(count(index, /\bcreateScopeAccess\(/)).toBe(count(parts, /\bcreateScopeAccess\(/));
    // The runtime's options: none at all without them (no instructionLinked, linkedGitdir or onLinkedUnsupported key).
    const from = index.indexOf("function linkedRuntimeOptions()");
    const runtime = index.slice(from, index.indexOf("\n}\n", from));
    expect(runtime).toContain("if (!linked) return {};");
    for (const key of [/\binstructionLinked:/, /\blinkedGitdir:/, /\bonLinkedUnsupported:/]) expect(count(index, key), String(key)).toBe(count(runtime, key));
    // The turn's access and board mode's first-message section are getters that give undefined without them.
    expect(group(index, index.indexOf("get scopeAccess()"), /\{/)).toContain("return linked ? ");
    expect(group(index, index.indexOf("get linkedContext()"), /\{/)).toContain("return linked && host ? ");
  });

  it("en.json has one sentence per refusal reason, and the window's reasons cover the picker's", async () => {
    const union = (text: string, name: string) => {
      const at = text.indexOf(`export type ${name} =`);
      return [...text.slice(at, text.indexOf(";", at)).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    };
    const picker = union(await read("linked-folders.ts"), "LinkRefusal");
    const view = union(await fs.readFile(path.resolve(__dirname, "../../ui/src/client.ts"), "utf8"), "LinkRefusalView");
    expect(picker.length).toBeGreaterThan(10);
    expect(view).toEqual(expect.arrayContaining(picker));
    const en = JSON.parse(await fs.readFile(path.resolve(__dirname, "../../i18n/src/locales/en.json"), "utf8")) as { hatches: { refused: Record<string, string> } };
    const refused = en.hatches.refused;
    expect(Object.keys(refused).sort()).toEqual([...view].sort());
    for (const sentence of Object.values(refused)) expect(sentence).toMatch(/^[A-Z].*\.$/);
  });
});
