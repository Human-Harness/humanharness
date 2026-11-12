import { describe, expect, it } from "vitest";
import { sidekickView } from "../src/main/sidekick-view";

const VIEW = { id: "sidekick", name: "Sidekick", mark: "coach" };

describe("sidekickView: Sidekick shows only to a harness that declares it", () => {
  it("no sidekick key: no view", () => {
    expect(sidekickView({})).toBeUndefined();
  });
  it("an empty block gives the view", () => {
    expect(sidekickView({ sidekick: {} })).toEqual(VIEW);
  });
  it("a full block gives the view", () => {
    expect(sidekickView({ sidekick: { tips: "Be brief." } })).toEqual(VIEW);
  });
});
