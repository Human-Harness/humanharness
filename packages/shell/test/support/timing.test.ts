import { describe, expect, it } from "vitest";
import { expectFast } from "../../../../test/support/timing";

const sleep = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

describe("expectFast", () => {
  it("passes for a fast function and returns its result", () => {
    expect(expectFast(() => 42, 1000)).toBe(42);
  });

  it("fails with the measured best time for a function that runs past the limit", () => {
    expect(() => expectFast(() => sleep(30), 5)).toThrow(/expected best of 3 \(\d+(\.\d+)? ms\) under 5 ms/);
  });

  it("takes the best of three: one slow run does not fail it", () => {
    let calls = 0;
    expectFast(() => {
      if (++calls === 1) sleep(40);
    }, 20);
    expect(calls).toBe(3);
  });
});
