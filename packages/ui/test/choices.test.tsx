// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoicesBlock, readOptions } from "../src/ChoicesBlock";
import { renderIn } from "./render";

afterEach(cleanup);

const data = {
  options: [
    { label: "Go deeper", followUp: "Tell me more" },
    { label: "Compare", action: "engines" },
    { label: "Next topic →", next: true },
  ],
};

describe("ChoicesBlock", () => {
  it("offers each option as a radio and hands the pick over", async () => {
    const choose = vi.fn(() => true);
    await renderIn("es", <ChoicesBlock data={data} choose={choose} active />);
    const group = screen.getByRole("radiogroup", { name: "¿Cómo seguimos?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Go deeper", "Compare", "Next topic →"]);
    expect(radios[2].className).toContain("next");
    fireEvent.click(radios[2]);
    expect(choose).toHaveBeenCalledWith({ label: "Next topic →", next: true });
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect((radios[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays unpicked when the pick is refused", async () => {
    await renderIn("en", <ChoicesBlock data={data} choose={() => false} active />);
    fireEvent.click(screen.getByRole("radio", { name: "Go deeper" }));
    expect(screen.getByRole("radio", { name: "Go deeper" }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("radio", { name: "Compare" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("can't be used once the conversation moved on, and shows nothing for malformed data", async () => {
    await renderIn(
      "en",
      <>
        <ChoicesBlock data={data} choose={() => true} active={false} />
        <ChoicesBlock data={{ options: [{ nope: 1 }, "x"] }} choose={() => true} active />
        <ChoicesBlock data={null} choose={() => true} active />
      </>,
    );
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("readOptions", () => {
  it("keeps only well-formed fields", () => {
    expect(readOptions({ options: [{ label: "A", followUp: "", action: 3, next: "yes" }, { label: "B", action: "turn", next: true }] })).toEqual([
      { label: "A" },
      { label: "B", action: "turn", next: true },
    ]);
  });
});
