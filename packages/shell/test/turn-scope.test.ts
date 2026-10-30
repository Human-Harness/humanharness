import { describe, expect, it } from "vitest";
import type { Event, HarnessRuntime } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/protocol";
import { TurnController } from "../src/main/turn-controller";
import type { UsageMeta } from "../src/main/usage-log";

/** A controller over a runtime whose turns end at once. */
function setup() {
  const chats: (string | undefined)[] = [];
  const metas: UsageMeta[] = [];
  const sends: unknown[] = [];
  const runtime = {
    send: (_m: string, emit: (e: Event) => void, options?: unknown) => {
      sends.push(options);
      emit({ type: "done", ok: true });
      return { cancel: () => {}, done: Promise.resolve() };
    },
    history: {},
    close: async () => {},
  } as unknown as HarnessRuntime;
  const controller = new TurnController({
    ensureRuntime: async () => runtime,
    chatLog: async (chat) => {
      chats.push(chat);
      return { append: async (_e: ChatEntry) => {} };
    },
    stateBlocks: () => new Set(),
    emit: () => {},
    recordUsage: async (_entry, meta) => void metas.push(meta),
  });
  return { controller, chats, metas, sends };
}

describe("turns in a scope", () => {
  it("write the open scope's chat, and tag usage and history with the task's scope", async () => {
    const t = setup();
    await t.controller.send("hi", { task: "t1", action: "onboarding", scope: "_app", chat: "fracciones" });
    expect(t.chats).toEqual(["fracciones"]);
    expect(t.metas[0]).toMatchObject({ task: "t1", action: "onboarding", scope: "_app" });
    expect(t.sends[0]).toEqual({ trailer: { task: "t1", action: "onboarding", scope: "_app" } });
  });

  it("keep today's chat, usage and trailer without a scope (spec D2)", async () => {
    const t = setup();
    await t.controller.send("hi", { task: "t1" });
    expect(t.chats).toEqual([undefined]);
    expect(t.metas[0]).not.toHaveProperty("scope");
    expect(t.sends[0]).toEqual({ trailer: { task: "t1" } });
  });
});
