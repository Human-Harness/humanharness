import { describe, expect, it } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
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

describe("a turn's engine preset and its profile (subagent policy D2)", () => {
  type Sent = { scope?: { engine?: typeof preset } };
  const preset = { hash: "h", base: "isolated" as const, servers: [], agentsFile: "/snap/agents.json" };
  const profile: ModelProfile = { engine: "claude", tier: "standard", effort: "medium", cap: 200000, subagentModel: "claude-haiku-4-5" };
  const build = (presetFor?: (e: typeof preset, p: unknown) => Promise<typeof preset>) => {
    const sends: Sent[] = [];
    const runtime = {
      send: (_m: string, emit: (e: Event) => void, options?: unknown) => {
        sends.push((options as Sent) ?? {});
        emit({ type: "done", ok: true });
        return { cancel: () => {}, done: Promise.resolve() };
      },
    } as unknown as HarnessRuntime;
    const controller = new TurnController({
      ensureRuntime: async () => runtime as never,
      chatLog: async () => ({ append: async (_e: ChatEntry) => {} }),
      stateBlocks: () => new Set(),
      emit: () => {},
      ...(presetFor ? { presetFor: presetFor as never } : {}),
    });
    return { controller, sends };
  };

  it("asks for the preset of the turn's profile and sends that one", async () => {
    const seen: unknown[] = [];
    const t = build(async (e, p) => (seen.push(p), { ...e, agentsFile: "/data/merged.json" }));
    await t.controller.send("hi", { task: "t1", profile, engine: preset });
    expect(seen).toEqual([profile]);
    expect(JSON.stringify(t.sends[0])).toContain("/data/merged.json");
    expect(JSON.stringify(t.sends[0])).not.toContain("/snap/agents.json");
  });

  it("without the dep, or when it fails, the preset goes as it is; without a preset it is never asked", async () => {
    const plain = build();
    await plain.controller.send("hi", { task: "t1", profile, engine: preset });
    expect(JSON.stringify(plain.sends[0])).toContain("/snap/agents.json");
    const failing = build(async () => {
      throw new Error("disk");
    });
    await failing.controller.send("hi", { task: "t1", profile, engine: preset });
    expect(JSON.stringify(failing.sends[0])).toContain("/snap/agents.json");
    let asked = 0;
    const none = build(async (e) => (asked++, e));
    await none.controller.send("hi", { task: "t1", profile });
    expect(asked).toBe(0);
  });
});
