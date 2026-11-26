import { describe, expect, it } from "vitest";
import { sidekickView } from "../src/view";

const VIEW = { id: "sidekick", name: "Sidekick", mark: "coach" };

describe("sidekickView: Sidekick shows only to a harness that declares it", () => {
  it("no mods.sidekick: no view", () => {
    expect(sidekickView({})).toBeUndefined();
    expect(sidekickView({ mods: { other: {} } })).toBeUndefined();
  });
  it("an empty block gives the view", () => {
    expect(sidekickView({ mods: { sidekick: {} } })).toEqual(VIEW);
  });
  it("a full block gives the view", () => {
    expect(sidekickView({ mods: { sidekick: { tips: "Be brief." } } })).toEqual(VIEW);
  });
});
