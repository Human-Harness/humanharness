// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlaggedText, flaggedParts } from "../src/sidekick/FlaggedText";

afterEach(cleanup);

describe("FlaggedText", () => {
  it("splits the text at the spans, merging overlaps and dropping spans out of range", () => {
    expect(
      flaggedParts("make it better", [
        [8, 14],
        [10, 12],
        [20, 30],
      ]),
    ).toEqual([
      { text: "make it ", flagged: false },
      { text: "better", flagged: true },
    ]);
  });

  it("clamps a span past the end to the text and skips reversed or empty spans", () => {
    expect(
      flaggedParts("make it better", [
        [8, 40],
        [5, 2],
        [3, 3],
        [-4, 4],
      ]),
    ).toEqual([
      { text: "make", flagged: true },
      { text: " it ", flagged: false },
      { text: "better", flagged: true },
    ]);
  });

  it("draws marks behind the field, hidden from screen readers", () => {
    const { container } = render(
      <FlaggedText text="make it better" spans={[[8, 14]]}>
        <textarea />
      </FlaggedText>,
    );
    const backdrop = container.querySelector(".hh-sk-backdrop")!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.querySelector("mark")?.textContent).toBe("better");
    expect(container.querySelector(".hh-sk-flagged textarea")).not.toBeNull();
  });

  it("the backdrop follows the field's scroll", () => {
    const { container } = render(
      <FlaggedText text="make it better" spans={[[8, 14]]}>
        <textarea />
      </FlaggedText>,
    );
    const field = container.querySelector("textarea")!;
    field.scrollTop = 30;
    fireEvent.scroll(field);
    expect(container.querySelector<HTMLDivElement>(".hh-sk-backdrop")!.scrollTop).toBe(30);
  });

  it("a backdrop that appears under an already-scrolled field starts at the field's scroll", () => {
    const { container, rerender } = render(
      <FlaggedText text="make it better" spans={[]}>
        <textarea />
      </FlaggedText>,
    );
    container.querySelector("textarea")!.scrollTop = 30;
    rerender(
      <FlaggedText text="make it better" spans={[[8, 14]]}>
        <textarea />
      </FlaggedText>,
    );
    expect(container.querySelector<HTMLDivElement>(".hh-sk-backdrop")!.scrollTop).toBe(30);
  });

  it("no spans: only the field, still in its wrapper so it keeps focus as spans come and go", () => {
    const { container } = render(
      <FlaggedText text="x" spans={[]}>
        <textarea />
      </FlaggedText>,
    );
    expect(container.querySelector(".hh-sk-backdrop")).toBeNull();
    expect(container.querySelector(".hh-sk-flagged textarea")).not.toBeNull();
  });

  it("only out-of-range spans: only the field", () => {
    const { container } = render(
      <FlaggedText text="x" spans={[[5, 9]]}>
        <textarea />
      </FlaggedText>,
    );
    expect(container.querySelector(".hh-sk-backdrop")).toBeNull();
  });
});
