import { describe, expect, it } from "vitest";
import { needsHost, toTurnEnd } from "../../src/main/mods/wiring";

describe("mods wiring", () => {
  it("builds no host with nothing declared, nothing local, and no core mod (D0)", () => {
    expect(needsHost({ declared: undefined, local: [], coreIds: [] })).toBe(false);
    expect(needsHost({ declared: { echo: {} }, local: [], coreIds: [] })).toBe(true);
    expect(needsHost({ declared: undefined, local: ["/x"], coreIds: [] })).toBe(true);
    expect(needsHost({ declared: undefined, local: [], coreIds: ["sidekick"] })).toBe(true);
  });
  it("passes a TurnEnd through without the kind", () => {
    const end = { task: { id: "t", scope: "main" }, kind: "run" as const, ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false };
    expect(toTurnEnd(end)).toEqual({ task: { id: "t", scope: "main" }, ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false });
  });
});
