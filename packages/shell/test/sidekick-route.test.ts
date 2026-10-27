import { DEFAULT_SIDEKICK, type SidekickDef } from "@humanharness/harness-sdk";
import { describe, expect, it, vi } from "vitest";
import { candidates, pickSpeaker } from "../src/main/sidekick-route";

const RULO: SidekickDef = { id: "rulo", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }, { id: "process-guard" }], order: 1 };
const on = async () => ({ on: true });

describe("candidates (spec §2a.3)", () => {
  it("only sidekicks on in the scope with a purpose for the moment", async () => {
    const off = async (_s: string, id: string) => ({ on: id !== "rulo" });
    expect((await candidates([DEFAULT_SIDEKICK, RULO], "after-reply", "main", on)).map((k) => k.id)).toEqual(["sidekick", "rulo"]);
    expect((await candidates([DEFAULT_SIDEKICK, RULO], "after-reply", "main", off)).map((k) => k.id)).toEqual(["sidekick"]);
    expect((await candidates([DEFAULT_SIDEKICK, RULO], "phase-change", "main", on)).map((k) => k.id)).toEqual(["rulo"]);
    expect(await candidates([DEFAULT_SIDEKICK], "daily", "main", on)).toEqual([]);
  });

  it("muted kinds don't remove a candidate (they only filter its cards)", async () => {
    expect(await candidates([DEFAULT_SIDEKICK], "pre-send", "main", on)).toHaveLength(1);
  });

  it("in the person's order, whatever order the list comes in; a failing scope read counts as on", async () => {
    const first = { ...RULO, order: 0 };
    const second = { ...DEFAULT_SIDEKICK, order: 1 };
    expect((await candidates([second, first], "after-reply", "main", on)).map((k) => k.id)).toEqual(["rulo", "sidekick"]);
    const broken = async () => {
      throw new Error("disk");
    };
    expect(await candidates([DEFAULT_SIDEKICK], "pre-send", "main", broken)).toHaveLength(1);
  });

  it("asks the scope for each sidekick through scopeFor, with the scope given", async () => {
    const scopeFor = vi.fn(on);
    await candidates([DEFAULT_SIDEKICK, RULO], "after-reply", "thesis", scopeFor);
    expect(scopeFor.mock.calls).toEqual([
      ["thesis", "sidekick"],
      ["thesis", "rulo"],
    ]);
  });
});

describe("pickSpeaker (spec §2a.3, D11)", () => {
  it("one candidate: no routing turn", async () => {
    const route = vi.fn();
    expect(await pickSpeaker([DEFAULT_SIDEKICK], "pre-send", route)).toBe(DEFAULT_SIDEKICK);
    expect(route).not.toHaveBeenCalled();
  });

  it("several: free routing first (a local rule by purpose), the person's order on a tie", async () => {
    const route = vi.fn();
    // after-reply with prompt-coach and mentor ties → order
    expect((await pickSpeaker([RULO, DEFAULT_SIDEKICK].sort((a, b) => a.order - b.order), "after-reply", route)).id).toBe("sidekick");
    expect(route).not.toHaveBeenCalled();
  });

  it("custom purposes on the same moment: one light routing turn picks; a bad answer falls back to order", async () => {
    const a: SidekickDef = { ...RULO, id: "a", order: 0, purposes: [{ id: "custom", text: "Watch tests.", moments: ["after-reply"] }] };
    const b: SidekickDef = { ...RULO, id: "b", order: 1, purposes: [{ id: "custom", text: "Watch docs.", moments: ["after-reply"] }] };
    expect((await pickSpeaker([a, b], "after-reply", async () => "b")).id).toBe("b");
    expect((await pickSpeaker([a, b], "after-reply", async () => "nobody")).id).toBe("a");
    expect((await pickSpeaker([a, b], "after-reply", async () => { throw new Error("x"); })).id).toBe("a");
  });

  it("the routing turn sees only the custom purposes for this moment", async () => {
    const a: SidekickDef = {
      ...RULO,
      id: "a",
      order: 0,
      purposes: [
        { id: "custom", text: "Watch tests.", moments: ["after-reply"] },
        { id: "custom", text: "Daily recap.", moments: ["daily"] },
      ],
    };
    const b: SidekickDef = { ...RULO, id: "b", order: 1, purposes: [{ id: "custom", text: "Watch docs.", moments: ["after-reply"] }] };
    const route = vi.fn(async () => "a");
    await pickSpeaker([a, b], "after-reply", route);
    expect(route).toHaveBeenCalledWith([
      { id: "a", text: "Watch tests." },
      { id: "b", text: "Watch docs." },
    ]);
  });

  it("a core purpose among the candidates: no routing turn, the person's order", async () => {
    const b: SidekickDef = { ...RULO, id: "b", order: 1, purposes: [{ id: "custom", text: "Watch docs.", moments: ["after-reply"] }] };
    const route = vi.fn(async () => "b");
    expect((await pickSpeaker([DEFAULT_SIDEKICK, b], "after-reply", route)).id).toBe("sidekick");
    expect(route).not.toHaveBeenCalled();
  });
});
