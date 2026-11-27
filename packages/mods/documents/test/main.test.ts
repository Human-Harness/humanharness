// The documents mod's main: the reader's five app channels and two pushes, under the names the window already calls.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CoreMainCtx, CoreSender } from "@humanharness/mod-sdk/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import mod from "../src/main";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-docs-mod-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n");

type Fn = (...args: unknown[]) => unknown;
const SENDER: CoreSender = { id: 7 };

/** Runs the mod's main on a fake core ctx; `folder` is what `ctx.app.documents.folder()` answers. */
function run(folder: { base: string; roots(): Promise<string[]> } | null = { base: root, roots: async () => [root] }) {
  const channels = new Map<string, Fn>();
  const hooks = new Map<string, Fn>();
  const pushed: [string, unknown][] = [];
  const hook = (name: string) => (fn: Fn) => (hooks.set(name, fn), () => void hooks.delete(name));
  mod.main!({
    app: { documents: { folder: async () => folder } },
    handle: (name: string, fn: Fn) => (channels.set(name, (_sender, ...args) => fn(...args)), () => {}),
    handleFrom: (name: string, fn: Fn) => (channels.set(name, fn), () => {}),
    push: (name: string, value: unknown) => void pushed.push([name, value]),
    on: { windowClosed: hook("windowClosed"), folderChanged: hook("folderChanged"), dispose: hook("dispose") },
  } as unknown as CoreMainCtx<unknown> as never);
  const call = async (name: string, ...args: unknown[]) => channels.get(name)!(SENDER, ...args);
  return { channels, hooks, pushed, call };
}

describe("the documents mod's main", () => {
  it("is the mod `documents`", () => {
    expect(mod.id).toBe("documents");
  });

  it("answers the reader's channels under their names", async () => {
    const m = run();
    expect([...m.channels.keys()].sort()).toEqual(["hh:documentsExist", "hh:readDocument", "hh:readImage", "hh:unwatchDocument", "hh:watchDocument"]);
    expect(await m.call("hh:readDocument", "plan.md")).toMatchObject({ ok: true, text: "# Plan\n" });
    expect(await m.call("hh:readImage", "plan.md")).toBeNull();
    expect(await m.call("hh:documentsExist", ["plan.md", "no.md"])).toEqual([true, false]);
  });

  it("before setup, answers each in the shape its caller handles", async () => {
    const m = run(null);
    expect(await m.call("hh:readDocument", "plan.md")).toEqual({ ok: false, reason: "not-ready" });
    expect(await m.call("hh:readImage", "a.png")).toBeNull();
    expect(await m.call("hh:documentsExist", ["plan.md"])).toEqual([false]);
    expect(await m.call("hh:watchDocument", "plan.md")).toBeNull();
  });

  it("pushes a change of a watched document, until the folder changes: then the watch ends and is said", async () => {
    const m = run();
    const id = (await m.call("hh:watchDocument", "plan.md")) as number;
    expect(typeof id).toBe("number");
    fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n");
    await vi.waitFor(() => expect(m.pushed).toContainEqual(["hh:documentChanged", id]), { timeout: 5000 });
    m.pushed.length = 0;
    await m.hooks.get("folderChanged")!();
    expect(m.pushed).toEqual([["hh:documentWatchEnded", id]]);
  });

  it("windowClosed ends that window's watches only", async () => {
    const m = run();
    const id = (await m.call("hh:watchDocument", "plan.md")) as number;
    await m.hooks.get("windowClosed")!(8);
    expect(m.pushed).toEqual([]);
    await m.hooks.get("windowClosed")!(SENDER.id);
    expect(m.pushed).toEqual([["hh:documentWatchEnded", id]]);
  });

  it("an unwatch by its window ends the watch without saying so", async () => {
    const m = run();
    const id = await m.call("hh:watchDocument", "plan.md");
    await m.call("hh:unwatchDocument", id);
    await m.hooks.get("folderChanged")!();
    expect(m.pushed).toEqual([]);
  });

  it("going off ends every watch", async () => {
    const m = run();
    const id = await m.call("hh:watchDocument", "plan.md");
    await m.hooks.get("dispose")!();
    expect(m.pushed).toEqual([["hh:documentWatchEnded", id]]);
  });

  it("without the app (a headless run) registers nothing", () => {
    expect(() => mod.main!({} as never)).not.toThrow();
  });
});
