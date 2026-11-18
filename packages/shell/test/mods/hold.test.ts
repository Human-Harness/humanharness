import type { MainCtx, SendInfo } from "@humanharness/mod-sdk";
import { describe, expect, it, vi } from "vitest";
import { chatIpc, type ChatIpcDeps } from "../../src/main/chat-ipc";
import { type HostDeps, ModHost } from "../../src/main/mods/host";

const task = { id: "t1", scope: "main" };
const send = (text = "hi"): SendInfo => ({ text, task });

async function host(over: Partial<HostDeps> = {}) {
  const deps: HostDeps = {
    config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) },
    services: () => ({}),
    notice: vi.fn(),
    changed: vi.fn(),
    beforeSendMs: 5_000,
    hookMs: 5_000,
    ...over,
  };
  const h = new ModHost(deps);
  await h.start([]);
  return h;
}

/** A mod that holds every send and keeps its ctx, so the test can resolve the token later. */
function holder(h: ModHost, id = "holder") {
  const got: { ctx?: MainCtx<unknown>; tokens: string[] } = { tokens: [] };
  h.registerForTest(id, "Holder", (ctx) => {
    got.ctx = ctx;
    ctx.on.beforeSend(() => {
      const token = `tok-${got.tokens.length}`;
      got.tokens.push(token);
      return { kind: "hold", token };
    });
  });
  return got;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("beforeSend hold", () => {
  it("a hold blocks the send until the mod resolves it; pass sends the original text", async () => {
    const h = await host();
    const m = holder(h);
    let done = false;
    const p = h.beforeSend(send("original")).then((t) => ((done = true), t));
    await tick();
    expect(done).toBe(false);
    expect(m.ctx!.holds.resolve("tok-0", { kind: "pass" })).toBe(true);
    expect(await p).toBe("original");
  });

  it("resolving with a rewrite sends the new text; a second resolve finds nothing", async () => {
    const h = await host();
    const m = holder(h);
    const p = h.beforeSend(send());
    await tick();
    m.ctx!.holds.resolve("tok-0", { kind: "rewrite", text: "better" });
    expect(await p).toBe("better");
    expect(m.ctx!.holds.resolve("tok-0", { kind: "pass" })).toBe(false);
  });

  it("the mod may cancel the send itself", async () => {
    const h = await host();
    const m = holder(h);
    const p = h.beforeSend(send());
    await tick();
    m.ctx!.holds.resolve("tok-0", { kind: "cancel" });
    expect(await p).toBeNull();
  });

  it("the budget applies while the handler runs, not while the send is held", async () => {
    const h = await host({ beforeSendMs: 40, hookMs: 40 });
    const m = holder(h);
    // A second mod after the holder still runs: the hold's wait spent none of the budget.
    h.registerForTest("after", "After", (ctx) => ctx.on.beforeSend((s) => ({ kind: "rewrite", text: `${s.text}!` })));
    const p = h.beforeSend(send("x"));
    await new Promise((r) => setTimeout(r, 120));
    m.ctx!.holds.resolve("tok-0", { kind: "pass" });
    expect(await p).toBe("x!");
    expect(h.view().find((r) => r.id === "holder")).toMatchObject({ on: true });
  });

  it("a handler that runs past the budget before holding is a timeout, and the text goes", async () => {
    const h = await host({ beforeSendMs: 30, hookMs: 30 });
    h.registerForTest("late", "Late", (ctx) => ctx.on.beforeSend(() => new Promise((r) => setTimeout(() => r({ kind: "hold", token: "t" }), 200))));
    expect(await h.beforeSend(send("x"))).toBe("x");
  });

  it("closing the task cancels a send held for it", async () => {
    const h = await host();
    holder(h);
    const p = h.beforeSend(send());
    await tick();
    await h.taskClose(task);
    expect(await p).toBeNull();
  });

  it("closing another task leaves the hold", async () => {
    const h = await host();
    const m = holder(h);
    const p = h.beforeSend(send());
    await tick();
    await h.taskClose({ id: "other", scope: "main" });
    m.ctx!.holds.resolve("tok-0", { kind: "pass" });
    expect(await p).toBe("hi");
  });

  it("quitting cancels a held send", async () => {
    const h = await host();
    holder(h);
    const p = h.beforeSend(send());
    await tick();
    await h.stop();
    expect(await p).toBeNull();
  });

  it("turning the mod off cancels its held send", async () => {
    const h = await host();
    holder(h);
    const p = h.beforeSend(send());
    await tick();
    await h.set("holder", false);
    expect(await p).toBeNull();
  });

  it("a hold never resolved is no strike; a handler that throws is one", async () => {
    const h = await host();
    holder(h);
    for (let i = 0; i < 3; i++) {
      const p = h.beforeSend(send());
      await tick();
      await h.taskClose(task);
      await p;
    }
    expect(h.view().find((r) => r.id === "holder")).toMatchObject({ on: true });
    const thrower = await host();
    thrower.registerForTest("thrower", "Thrower", (ctx) =>
      ctx.on.beforeSend(() => {
        throw new Error("no");
      }),
    );
    for (let i = 0; i < 2; i++) expect(await thrower.beforeSend(send("x"))).toBe("x");
    expect(thrower.view()[0]).toMatchObject({ on: true });
    await thrower.beforeSend(send("x"));
    expect(thrower.view()[0]).toMatchObject({ on: false, failed: "no" });
  });
});

describe("hh:send with a held send", () => {
  function chat(beforeSend: (s: SendInfo) => Promise<string | null>, quitting = () => false) {
    const ask = vi.fn(async () => {});
    const deps = {
      harness: () => ({ actions: {} }),
      quitting,
      turnBlocked: () => null,
      tasks: () => ({ runningTask: async () => null, ask }),
      modHost: () => ({ beforeSend }),
    } as unknown as ChatIpcDeps;
    return { send: chatIpc(deps)["hh:send"], ask };
  }

  it("sends the text the hold ended with", async () => {
    const c = chat(async () => "held then sent");
    await c.send("hi");
    expect(c.ask).toHaveBeenCalledWith("held then sent", undefined, undefined);
  });

  it("sends nothing when the hold was cancelled", async () => {
    const c = chat(async () => null);
    await c.send("hi");
    expect(c.ask).not.toHaveBeenCalled();
  });

  it("refuses a send whose hold ended while the app was closing", async () => {
    let quitting = false;
    const c = chat(
      async (s) => {
        quitting = true;
        return s.text;
      },
      () => quitting,
    );
    await expect(c.send("hi")).rejects.toThrow("The app is closing");
    expect(c.ask).not.toHaveBeenCalled();
  });
});
