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
    // Engine approvals (hatches part 3) check their tag with the same key, only from the enginePresets-gated host.
    const engine = group(index, index.indexOf("function engineHost_(): EngineHost | undefined"), /\{/);
    expect(engine).toMatch(/^function engineHost_\(\): EngineHost \| undefined \{\s*if \(!hasEnginePresets\(harness\)\) return undefined;/);
    expect(count(engine, /\blinkedSecret\(userData\)\(false\)/)).toBe(1);
    // Only the key: no live set, no prune, no key file named there (the sum below can't hide one).
    for (const name of [/\blinkedSigning\(/, /\bpruneUnlinked\(/, /linked-key/, /linked-live\.json/]) expect(count(engine, name), String(name)).toBe(0);
    // Approving one signs with it, made then if needed: only from the engine channels' deps (registered under enginePresets).
    const approve = group(index, index.indexOf("function engineIpcDeps(): EngineIpcDeps"), /\{/);
    expect(count(approve, /\blinkedSecret\(userData\)\(true\)/)).toBe(1);
    expect(count(approve, /\blinkedSecret\(/)).toBe(1);
    for (const name of [/\blinkedSigning\(/, /\blinkedSecret\(/, /\bpruneUnlinked\(/, /"linked-key"/, /"linked-live\.json"/]) {
      expect(count(index, name), String(name)).toBe(count(deps, name) + count(engine, name) + count(approve, name));
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

  it("engine channels are registered only under enginePresets", async () => {
    const index = await read("index.ts");
    expect(count(index, /registerEngineIpc\(/)).toBe(1);
    expect(index).toContain("  if (hasEnginePresets(harness)) engineIpc = registerEngineIpc(handle, engineIpcDeps());\n");
    // Its deps (and so the approval key) are built only there; the commit signal reaches it only once registered.
    expect(count(index, /\bengineIpcDeps\(\)/)).toBe(2); // the definition and that one call
    expect(count(index, /\bengineIpc = /)).toBe(1);
    expect(index).toMatch(/let engineIpc: EngineIpc \| null = null;/);
    // No other file registers or sends them: the channel names appear only in engine-ipc.ts (hh:engineStatus is the core's).
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts"))) {
      if (f === path.join("engine-config", "engine-ipc.ts")) continue;
      expect(await read(f), f).not.toMatch(/hh:engine(Config|Approve|Revoke)/);
    }
    // The preload and the window name them, but main answers only under enginePresets.
    const ipc = await read(path.join("engine-config", "engine-ipc.ts"));
    expect(count(ipc, /handle\("hh:engine(Config|Approve|Revoke)/)).toBe(3);
  });

  it("engine snapshots are pruned at start only under enginePresets (Decision 13, D0)", async () => {
    const index = await read("index.ts");
    expect(index).toContain("  if (hasEnginePresets(harness)) void pruneEngineConfig();\n");
    expect(count(index, /\bpruneEngineConfig\(\)/)).toBe(2); // the definition and that one call
    expect(count(index, /\bpruneEngineSnapshots\(/)).toBe(1);
    const prune = group(index, index.indexOf("async function pruneEngineConfig(): Promise<void>"), /\{/);
    expect(prune).toContain("pruneEngineSnapshots(");
  });

  it("hatchesState carries enginePresets: true only with enginePresets (D0)", () => {
    expect(hatchesState(defineHarness(base))).toBeUndefined();
    expect(hatchesState(defineHarness({ ...base, enginePresets: true }))).toEqual({ enginePresets: true });
    expect(hatchesState(defineHarness({ ...base, backend: "b.ts" }))).not.toHaveProperty("enginePresets");
    expect(hatchesState(defineHarness({ ...base, enginePresets: true, linkedFolders: { repos: { label: "Repos", mode: "read" } } }))).toEqual({
      linkedFolders: { repos: { label: "Repos", mode: "read", history: "auto", many: false } },
      enginePresets: true,
    });
  });

  it("backend channels are registered only under hasBackend (D0)", async () => {
    const index = await read("index.ts");
    expect(count(index, /registerBackendIpc\(/)).toBe(1);
    expect(count(index, /\bbackendFor\(/)).toBe(1);
    const block = group(index, index.indexOf("if (hasBackend(harness))"), /\{/);
    expect(block).toContain("registerBackendIpc(handle, { supervisor: backend });");
    // The supervisor is made only by backendFor, which answers null without a backend; nothing else spawns one.
    expect(count(index, /\bbackend = /)).toBe(1);
    expect(index).toMatch(/\bbackend = backendFor\(harness, \{/);
    // The one spawn sits in that block, as backendFor's startProcess.
    expect(count(index, /BackendProcess\.start\(/)).toBe(1);
    expect(count(block, /BackendProcess\.start\(/)).toBe(1);
    for (const f of (await fs.readdir(main, { recursive: true })).filter((f) => f.endsWith(".ts"))) {
      if (f.startsWith("backend")) continue;
      const text = await read(f);
      expect(text, f).not.toMatch(/new BackendSupervisor|hh:backend/);
      if (f !== "index.ts") expect(text, f).not.toMatch(/BackendProcess\.start/);
    }
  });

  it("hatchesState carries backend: true only with a backend (D0)", () => {
    expect(hatchesState(defineHarness({ ...base, backend: "b.ts" }))).toEqual({ backend: true });
    const linked = hatchesState(defineHarness({ ...base, linkedFolders: { repos: { label: "Repos", mode: "write" } } }));
    expect(linked).not.toHaveProperty("backend");
    expect(hatchesState(defineHarness({ ...base, backend: "b.ts", linkedFolders: { repos: { label: "Repos", mode: "read" } } }))).toEqual({
      linkedFolders: { repos: { label: "Repos", mode: "read", history: "auto", many: false } },
      backend: true,
    });
  });

  it("the window's scope list never carries links (only signed ones, through hh:scopeLinked)", async () => {
    const index = await read("index.ts");
    const view = group(index, index.indexOf("async function scopesView(): Promise<ScopesView>"), /\{/);
    expect(view).toContain(".map(({ linked: _linked, ...s }) => s)");
  });

  it("the window's scope list never carries an engine approval (only the Engine config view says approved)", async () => {
    const index = await read("index.ts");
    const view = group(index, index.indexOf("async function scopesView(): Promise<ScopesView>"), /\{/);
    expect(view).toContain(".map(({ engineApproval: _approval, ...s }) => s)");
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
    const view = union(await fs.readFile(path.resolve(__dirname, "../../protocol/src/views.ts"), "utf8"), "LinkRefusalView");
    expect(picker.length).toBeGreaterThan(10);
    expect(view).toEqual(expect.arrayContaining(picker));
    const en = JSON.parse(await fs.readFile(path.resolve(__dirname, "../../i18n/src/locales/en.json"), "utf8")) as { hatches: { refused: Record<string, string> } };
    const refused = en.hatches.refused;
    expect(Object.keys(refused).sort()).toEqual([...view].sort());
    for (const sentence of Object.values(refused)) expect(sentence).toMatch(/^[A-Z].*\.$/);
  });
});
