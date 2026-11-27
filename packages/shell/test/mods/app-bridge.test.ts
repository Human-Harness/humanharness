// The services and hooks the documents mod needs (minimal core step 4): only a core mod gets them, and each wraps the
// call the core makes today.
import path from "node:path";
import type { CoreMainCtx, CoreSender } from "@humanharness/mod-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { registerModAppChannels } from "../../src/main/mods/app-channels";
import { type CoreAppParts, coreAppFor } from "../../src/main/mods/core-app";
import { type CoreDocumentsDeps, coreDocuments } from "../../src/main/mods/core-documents";
import { createCoreEvents } from "../../src/main/mods/core-events";
import { type HostDeps, ModHost } from "../../src/main/mods/host";

async function host(over: Partial<HostDeps> = {}) {
  const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), ...over });
  await h.start([]);
  return h;
}

/** A test core mod's ctx. */
function coreMod(h: ModHost, id = "doc"): CoreMainCtx<unknown> {
  let ctx: CoreMainCtx<unknown> | undefined;
  h.registerForTest(id, "Doc", (c) => void (ctx = c as CoreMainCtx<unknown>), { core: true });
  return ctx!;
}

function fakes(over: Partial<CoreDocumentsDeps> = {}) {
  const tasks = {
    trailerNow: vi.fn(async () => ({ task: "t1", action: "plan" })),
    runningTask: vi.fn(async (): Promise<{ id: string; action?: string; scope: string } | null> => ({ id: "t1", action: "plan", scope: "main" })),
    isBusy: vi.fn(() => false),
    whenSettled: vi.fn((read: () => Promise<unknown>) => read()),
    reviewRound: vi.fn(async (): Promise<"open" | "new"> => "open"),
    documentApproved: vi.fn(async () => {}),
  };
  const history = { id: "history" };
  const d: CoreDocumentsDeps = {
    validConfig: async () => ({ folder: "/base", engineId: "claude" }) as never,
    baseOf: (c) => c.folder,
    workReferences: vi.fn(async () => [{ path: "/ref/a" }, { path: "/ref/b" }]),
    currentHistory: async () => history as never,
    tasks: () => tasks as never,
    quitting: () => false,
    turnBlocked: () => null,
    actions: () => ({ plan: { label: "Plan the week" } }),
    harness: () => ({ permissions: { edit: "none" } }) as never,
    here: "/app/out/main",
    ...over,
  };
  return { d, tasks, history, documents: coreDocuments(d) };
}

/** The mod host's `ctx.app`, built as the app builds it, with only the parts these tests reach. */
const appOf = (parts: Partial<CoreAppParts>) => (id: string) => coreAppFor({ harness: { name: "H" }, tasks: {}, history: {}, ...parts } as CoreAppParts, id);

describe("ctx.app.documents", () => {
  it("a core mod reaches the folder and its reference roots, resolved only when asked", async () => {
    const { documents, d } = fakes();
    const ctx = coreMod(await host({ coreApp: appOf({ documents }) }));
    const folder = await ctx.app.documents.folder();
    expect(folder?.base).toBe("/base");
    expect(d.workReferences).not.toHaveBeenCalled();
    expect(await folder!.roots()).toEqual(["/base", "/ref/a", "/ref/b"]);
    expect(d.workReferences).toHaveBeenCalledWith(expect.objectContaining({ folder: "/base" }), "/base");
  });

  it("whether the agent may edit the folder, and the harness's document kinds, read when asked", async () => {
    let harness: unknown = { permissions: { edit: "none" } };
    const ctx = coreMod(await host({ coreApp: appOf({ documents: fakes({ harness: () => harness as never }).documents }) }));
    expect(ctx.app.documents.canEdit()).toBe(false);
    expect(ctx.app.documents.kinds()).toEqual({});
    const kinds = { adr: { when: "A decision.", sections: ["Status"] } };
    harness = { permissions: { edit: "folder" }, documents: { kinds } };
    expect(ctx.app.documents.canEdit()).toBe(true);
    expect(ctx.app.documents.kinds()).toBe(kinds);
  });

  it("before setup there is no folder", async () => {
    const ctx = coreMod(await host({ coreApp: appOf({ documents: fakes({ validConfig: async () => null }).documents }) }));
    expect(await ctx.app.documents.folder()).toBeNull();
  });

  it("the history, the open task's trailer and the open task", async () => {
    const f = fakes();
    const ctx = coreMod(await host({ coreApp: appOf({ documents: f.documents }) }));
    expect(await ctx.app.documents.history()).toBe(f.history);
    expect(await ctx.app.documents.trailer()).toEqual({ task: "t1", action: "plan" });
    expect(await ctx.app.documents.openTask()).toEqual({ id: "t1", scope: "main" });
    f.tasks.runningTask.mockResolvedValueOnce(null);
    expect(await ctx.app.documents.openTask()).toBeNull();
  });

  it("busy, whenSettled and blocked are the task manager's and the app's holds", async () => {
    let held: string | null = null;
    let quitting = false;
    const f = fakes({ turnBlocked: () => held, quitting: () => quitting });
    const ctx = coreMod(await host({ coreApp: appOf({ documents: f.documents }) }));
    expect(ctx.app.documents.busy()).toBe(false);
    f.tasks.isBusy.mockReturnValue(true);
    expect(ctx.app.documents.busy()).toBe(true);
    expect(await ctx.app.documents.whenSettled(async () => 7)).toBe(7);
    expect(f.tasks.whenSettled).toHaveBeenCalledTimes(1);
    expect(ctx.app.documents.blocked()).toBeNull();
    held = "The engine is changing";
    expect(ctx.app.documents.blocked()).toBe("The engine is changing");
    quitting = true;
    expect(ctx.app.documents.blocked()).toBe("The app is closing");
  });

  it("a review round and an approval are the task manager's methods; their failures reach the mod", async () => {
    const f = fakes();
    const ctx = coreMod(await host({ coreApp: appOf({ documents: f.documents }) }));
    const round = { path: "a.md", title: "A", message: "Review a.md", scope: "main", tier: "standard" as const };
    expect(await ctx.app.documents.reviewRound(round)).toBe("open");
    expect(f.tasks.reviewRound).toHaveBeenCalledWith(round);
    const approval = { path: "a.md", task: "t1", reason: "looks right" };
    await ctx.app.documents.documentApproved(approval);
    expect(f.tasks.documentApproved).toHaveBeenCalledWith(approval);
    f.tasks.documentApproved.mockRejectedValueOnce(new Error("no round"));
    await expect(ctx.app.documents.documentApproved(approval)).rejects.toThrow("no round");
    const refused = new Error("A turn is already running");
    f.tasks.reviewRound.mockRejectedValueOnce(refused);
    await expect(ctx.app.documents.reviewRound(round)).rejects.toBe(refused);
  });

  it("an action's label, and the diff worker's entry", async () => {
    const ctx = coreMod(await host({ coreApp: appOf({ documents: fakes().documents }) }));
    expect(ctx.app.documents.actionLabel("plan")).toBe("Plan the week");
    expect(ctx.app.documents.actionLabel("gone")).toBe("gone");
    expect(ctx.app.documents.actionLabel("toString")).toBe("toString");
    expect(ctx.app.documents.actionLabel(null)).toBe("A question");
    expect(ctx.app.documents.diffWorker()).toBe(path.join("/app/out/main", "diff-worker.js"));
  });
});

describe("ctx.app.history.restoreFile", () => {
  it("hands the call's sender, file, commit and the mod's service to the core", async () => {
    const restoreFile = vi.fn(async () => ({ ok: false as const, reason: "cancelled" }));
    const ctx = coreMod(await host({ coreApp: appOf({ history: { restoreFile } as never }) }));
    const sender = { id: 3 };
    const service = { restorePrompt: vi.fn(), restore: vi.fn() };
    expect(await ctx.app.history.restoreFile(sender, "a.md", "abc", service)).toEqual({ ok: false, reason: "cancelled" });
    expect(restoreFile).toHaveBeenCalledWith(sender, "a.md", "abc", service);
  });
});

describe("the moments a core mod hears", () => {
  function listen(ctx: CoreMainCtx<unknown>) {
    const heard: unknown[][] = [];
    const offs = [
      ctx.on.historyCommit((p) => void heard.push(["historyCommit", p])),
      ctx.on.windowClosed((id) => void heard.push(["windowClosed", id])),
      ctx.on.folderChanged(() => void heard.push(["folderChanged"])),
      ctx.on.restored((p) => void heard.push(["restored", p])),
    ];
    return { heard, offs };
  }
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it("historyCommit(paths | null) is its own signal: a restore is not a commit", async () => {
    const h = await host();
    const { heard } = listen(coreMod(h));
    const events = createCoreEvents({ host: () => h });
    events.historyCommit(["a.md"]);
    events.historyCommit(null);
    events.restored(null);
    await tick();
    expect(heard).toEqual([["historyCommit", ["a.md"]], ["historyCommit", null], ["restored", null]]);
  });

  it("windowClosed(senderId) and folderChanged() reach it, until it drops them or goes off", async () => {
    const h = await host();
    const { heard, offs } = listen(coreMod(h));
    const events = createCoreEvents({ host: () => h });
    await h.windowClosed(7);
    events.folderChanged();
    await tick();
    expect(heard).toEqual([["windowClosed", 7], ["folderChanged"]]);
    offs[1]();
    await h.windowClosed(8);
    await h.set("doc", false);
    events.folderChanged();
    events.historyCommit(["b.md"]);
    await tick();
    expect(heard).toHaveLength(2);
  });

  it("dispose() reaches it as it goes off or the app quits, once, while it can still push", async () => {
    const pushed: unknown[] = [];
    const h = await host({ push: (channel, value) => void pushed.push([channel, value]) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const off = coreMod(h);
    off.on.dispose!(() => {
      throw new Error("boom");
    });
    off.on.dispose!(() => off.push("hh:documentWatchEnded", 1));
    const quit = coreMod(h, "other");
    quit.on.dispose!(() => quit.push("hh:documentWatchEnded", 2));
    await h.set("doc", false);
    expect(pushed).toEqual([["hh:documentWatchEnded", 1]]);
    await h.stop();
    expect(pushed).toEqual([["hh:documentWatchEnded", 1], ["hh:documentWatchEnded", 2]]);
  });

  it("a listener that throws never reaches the call site, and the others still hear", async () => {
    const h = await host();
    vi.spyOn(console, "error").mockImplementation(() => {});
    coreMod(h, "bad").on.folderChanged(() => Promise.reject(new Error("boom")));
    const { heard } = listen(coreMod(h));
    const events = createCoreEvents({ host: () => h });
    expect(() => events.folderChanged()).not.toThrow();
    await tick();
    expect(heard).toEqual([["folderChanged"]]);
  });

  it("with no host, nothing", () => {
    const events = createCoreEvents({ host: () => null });
    expect(() => (events.folderChanged(), events.historyCommit(null))).not.toThrow();
  });
});

describe("the sender of an app channel call", () => {
  async function wired() {
    const h = await host();
    const ipc = new Map<string, (sender: CoreSender, ...args: unknown[]) => unknown>();
    registerModAppChannels((channel, fn) => void ipc.set(channel, fn), () => h);
    return { h, ipc };
  }

  it("handleFrom gets the asking window before the call's arguments; handle gets the arguments only", async () => {
    const { h, ipc } = await wired();
    const ctx = coreMod(h);
    const from = vi.fn(() => "from");
    const plain = vi.fn(() => "plain");
    ctx.handleFrom("hh:watchDocument", from);
    ctx.handle("hh:unwatchDocument", plain);
    const sender = { id: 41 };
    expect(await ipc.get("hh:watchDocument")!(sender, "a.md", 2)).toBe("from");
    expect(from).toHaveBeenCalledWith(sender, "a.md", 2);
    expect(await ipc.get("hh:unwatchDocument")!(sender, "w1")).toBe("plain");
    expect(plain).toHaveBeenCalledWith("w1");
  });

  it("handleFrom follows handle's rules: listed channels only, one mod's at a time, off with the mod", async () => {
    const { h, ipc } = await wired();
    const ctx = coreMod(h);
    expect(() => ctx.handleFrom("hh:search", () => 1)).toThrow(/Not an app channel a core mod answers/);
    const off = ctx.handleFrom("hh:watchDocument", () => 1);
    expect(() => coreMod(h, "other").handle("hh:watchDocument", () => 2)).toThrow(/already handles/);
    off();
    expect(await ipc.get("hh:watchDocument")!({ id: 1 })).toBeNull();
    ctx.handleFrom("hh:watchDocument", () => 1);
    await h.set("doc", false);
    expect(h.handles("hh:watchDocument")).toBe(false);
  });
});

describe("harness and local mods get none of it", () => {
  it.each(["local", "harness"] as const)("a %s mod has no app, no handleFrom and no core moments", async (origin) => {
    const coreApp = vi.fn(appOf({ documents: fakes().documents }));
    const h = await host({ coreApp });
    let ctx: Record<string, unknown> = {};
    h.registerForTest("plain", "Plain", (c) => void (ctx = c as never), { origin });
    const on = ctx.on as Record<string, unknown>;
    expect([ctx.app, ctx.handle, ctx.handleFrom]).toEqual([undefined, undefined, undefined]);
    expect([on.historyCommit, on.windowClosed, on.folderChanged, on.dispose]).toEqual([undefined, undefined, undefined, undefined]);
    expect(coreApp).not.toHaveBeenCalled();
  });
});
