import { promises as fs } from "node:fs";
import path from "node:path";
import { type BackendInit, defineHarness } from "@humanharness/harness-sdk";
import type { ScopeEntry } from "@humanharness/workspace";
import { describe, expect, it, vi } from "vitest";
import { type BackendWiringDeps, backendFor, backendInit } from "../../src/main/backend/backend-ipc";
import type { BackendLogStream } from "../../src/main/backend/backend-log";
import type { BackendExit } from "../../src/main/backend/backend-process";
import type { SupervisedProcess } from "../../src/main/backend/backend-supervisor";

const plain = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: false }, blocks: {}, author: "x",
  actions: { implement: { label: "Implement", prompt: "./prompts/implement.md", cost: "medium" as const } },
};
const init: BackendInit = { folder: "/w", scopes: [], language: "en", coreVersion: "0.1.0", dataDir: "/d", mock: false };
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeProcess(): SupervisedProcess & { crash(): void } {
  let resolve!: (e: BackendExit) => void;
  const exited = new Promise<BackendExit>((r) => (resolve = r));
  return {
    exited,
    call: async () => null,
    notify: () => {},
    stop: async () => resolve({ code: null, signal: "SIGTERM", expected: true }),
    crash: () => resolve({ code: 1, signal: null, expected: false }),
  };
}

function deps(over: { startProcess?: BackendWiringDeps["startProcess"] } = {}) {
  return {
    startProcess: vi.fn<BackendWiringDeps["startProcess"]>(over.startProcess ?? (async () => fakeProcess())),
    send: vi.fn<BackendWiringDeps["send"]>(),
    log: { write: vi.fn(async (_stream: BackendLogStream, _text: string) => {}) },
    mainLog: vi.fn<BackendWiringDeps["mainLog"]>(),
  };
}

describe("the backend's wiring in main", () => {
  it("D0: a harness without backend never constructs a supervisor", async () => {
    const d = deps();
    expect(backendFor(defineHarness(plain), d)).toBeNull();
    expect(backendFor(defineHarness({ ...plain, linkedFolders: undefined }), d)).toBeNull();
    await settle();
    expect(d.startProcess).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.log.write).not.toHaveBeenCalled();
  });

  it("with a backend: states and events reach the window on their channels", async () => {
    let onEvent!: (event: string, data: unknown) => void;
    const d = deps({
      startProcess: async (_init, cb) => {
        onEvent = cb;
        return fakeProcess();
      },
    });
    const sup = backendFor(defineHarness({ ...plain, backend: "backend/index.ts" }), d)!;
    await sup.start(init);
    onEvent("tick", { n: 1 });
    expect(d.send.mock.calls).toEqual([
      ["hh:backendStateChange", "starting"],
      ["hh:backendStateChange", "running"],
      ["hh:backendEvent", { event: "tick", data: { n: 1 } }],
    ]);
  });

  it("an event the window can't take is logged, never thrown into the process", async () => {
    let onEvent!: (event: string, data: unknown) => void;
    const d = deps({
      startProcess: async (_init, cb) => {
        onEvent = cb;
        return fakeProcess();
      },
    });
    const sup = backendFor(defineHarness({ ...plain, backend: "backend/index.ts" }), d)!;
    await sup.start(init);
    d.send.mockImplementation(() => {
      throw new Error("window gone");
    });
    expect(() => onEvent("tick", null)).not.toThrow();
    expect(d.mainLog).toHaveBeenCalledWith("Could not send a backend event to the window", expect.any(Error));
  });

  it("a start that fails is written to backend.log once per attempt; failed writes one main-log line", async () => {
    let t = 0;
    const d = deps({
      startProcess: async () => {
        throw new Error(`spawn ENOENT ${++t}`);
      },
    });
    const sup = backendFor(defineHarness({ ...plain, backend: "backend/index.ts" }), d)!;
    await sup.start(init);
    // The first start, then three restarts: four attempts, then failed.
    expect(sup.state()).toBe("failed");
    expect(d.log.write.mock.calls).toEqual([1, 2, 3, 4].map((n) => ["app", `Could not start the backend: spawn ENOENT ${n}`]));
    expect(d.mainLog).toHaveBeenCalledTimes(1);
    expect(d.mainLog).toHaveBeenCalledWith("The harness's backend stopped working after crashing too often; see backend.log");
    expect(d.send).toHaveBeenLastCalledWith("hh:backendStateChange", "failed");
  });

  it("init for a base: folder, active scopes with links, language, coreVersion, dataDir under userData, mock", () => {
    const scopes: ScopeEntry[] = [
      { id: "main", title: "Main", createdAt: "x", archived: false },
      {
        id: "a", title: "A", createdAt: "x", archived: false,
        linked: [
          { key: "code", path: "/code", mode: "write", tracked: true, tag: "t", nonce: "n" },
          { key: "code", path: "/forged", mode: "write", tracked: true },
        ],
      },
      { id: "old", title: "Old", createdAt: "x", archived: true, linked: [{ key: "code", path: "/x", mode: "read", tracked: false }] },
    ];
    const got = backendInit({
      base: "/w/base",
      scopes,
      links: (s) => (s.linked ?? []).filter((l) => l.tag !== undefined),
      language: "es",
      coreVersion: "0.1.0",
      userData: "/u",
      mock: true,
    });
    expect(got).toEqual({
      folder: "/w/base",
      scopes: [
        { id: "main", title: "Main", linked: [] },
        { id: "a", title: "A", linked: [{ key: "code", path: "/code", mode: "write" }] },
      ],
      language: "es",
      coreVersion: "0.1.0",
      dataDir: path.join("/u", "backend-data"),
      mock: true,
    });
    // Exactly the BackendInit keys (B7: nothing else, no credential).
    expect(Object.keys(got).sort()).toEqual(["coreVersion", "dataDir", "folder", "language", "mock", "scopes"]);
  });

  it("init without a link checker carries no links; with profiles, dataDir is per profile", () => {
    const scopes: ScopeEntry[] = [{ id: "a", title: "A", createdAt: "x", archived: false, linked: [{ key: "k", path: "/p", mode: "read", tracked: false }] }];
    const got = backendInit({ base: "/w/p1", scopes, language: "en", coreVersion: "1", userData: "/u", profile: "p1", mock: false });
    expect(got.scopes).toEqual([{ id: "a", title: "A", linked: [] }]);
    expect(got.dataDir).toBe(path.join("/u", "backend-data", "p1"));
    for (const bad of ["..", ".", "a/b", "../x", "", "P1", "a.b", "-x"]) {
      expect(() => backendInit({ base: "/w", scopes: [], language: "en", coreVersion: "1", userData: "/u", profile: bad, mock: false })).toThrow();
    }
  });

  it("never names an engine home (B9)", async () => {
    const dir = path.resolve(__dirname, "../../src/main/backend");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".ts"));
    expect(files).toContain("backend-ipc.ts");
    for (const f of files) {
      const text = await fs.readFile(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/\.claude|\.codex|\.gemini|opencode|homedir/);
    }
  });
});
