// The core alone (minimal-core step 4): the reader, reviews and the file timeline are the documents mod's, so the shell
// imports none of the moved modules and builds its services with no mods and no documents object.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DataStore } from "@humanharness/workspace";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() }, dialog: {}, shell: {} }));

const { createAppServices } = await import("../src/main/app-services");
const { GO_BACK_CHANNELS } = await import("../src/main/go-back");
type Deps = Parameters<typeof createAppServices>[0];

const packages = path.resolve(import.meta.dirname, "../..");
const src = path.join(packages, "shell/src");

/** Where the moved modules were: now `packages/mods/documents/src/main`. */
const MOVED = [
  ...["diff-runner", "diff-worker", "document-ipc", "document-sessions", "documents", "file-ipc", "file-timeline", "review-ipc", "reviews"].map(
    (m) => `shell/src/main/${m}`,
  ),
  "runtime/src/review-agent",
  "workspace/src/file-diff",
].map((m) => path.join(packages, m));

/** The app services' deps with nothing running: no task, no history, no mods. */
function deps(): Deps {
  const base = os.tmpdir();
  const tasks = { isBusy: () => false, chatScope: async () => "_app", trailerNow: async () => undefined } as unknown as ReturnType<Deps["tasks"]>;
  return {
    harness: () => ({ id: "h", name: "H", actions: {}, data: {} }) as never,
    config: () => ({ load: async () => ({}) }) as never,
    guards: { turnBlocked: () => null } as never,
    quitting: () => false,
    moving: () => null,
    window: () => null,
    tasks: () => tasks,
    jobsHost: () => null,
    profilesCtl: () => null,
    settingsCtl: () => null,
    pluginsCtl: () => null,
    engineIpc: () => null,
    validConfig: async () => ({ folder: base, engineId: "claude" }) as never,
    baseOf: (c) => c.folder,
    scoped: () => false,
    activeScope: async () => false,
    dataStoreFor: (b) => new DataStore(b, {}),
    scopeStoreFor: () => ({ list: async () => [] }) as never,
    scopesView: async () => ({ list: [] }) as never,
    currentHistory: async () => null,
    currentBase: async () => base,
    ownCommits: () => false,
    closeRuntime: async () => {},
    arrivedInProfile: async () => {},
    workReferences: async () => [],
  };
}

async function sources(dir: string): Promise<string[]> {
  return (await fs.readdir(dir, { recursive: true })).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(dir, f));
}

describe("the core alone, without the documents modules", () => {
  it("builds the app services with no mods and no review, timeline or document-session object", () => {
    const s = createAppServices(deps());
    expect(Object.keys(s).filter((k) => /review|timeline|document|session/i.test(k))).toEqual([]);
  });

  it("the core's go-backs are the folder's and a task's; a file's is only a core mod's, through `restoreFile`", () => {
    expect([...GO_BACK_CHANNELS]).toEqual(["restore", "restoreTask"]);
  });

  it("the shell imports none of the moved modules, nor the documents mod from its main", async () => {
    const files = await sources(src);
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const m of text.matchAll(/(?:\bfrom|^import|\bimport\()\s*"([^"\n]+)"/gm)) {
        const spec = m[1];
        const target = spec.startsWith(".") ? path.resolve(path.dirname(file), spec).replace(/\.(js|tsx?)$/, "") : "";
        const modFromMain = file.startsWith(path.join(src, "main") + path.sep) && /mod-documents|mods\/documents/.test(spec);
        if (MOVED.includes(target) || modFromMain) offenders.push(`${path.relative(src, file)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no moved module is left where it was", async () => {
    const left: string[] = [];
    for (const m of MOVED) if (await fs.stat(`${m}.ts`).then(() => true, () => false)) left.push(path.relative(packages, m));
    expect(left).toEqual([]);
  });
});
