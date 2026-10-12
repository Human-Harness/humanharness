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
  it("offers each option as a button in a group and hands the pick over", async () => {
    const choose = vi.fn(() => true);
    await renderIn("es", <ChoicesBlock data={data} choose={choose} active />);
    const group = screen.getByRole("group", { name: "¿Cómo seguimos?" });
    const buttons = within(group).getAllByRole("button");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(buttons.map((r) => r.textContent)).toEqual(["Go deeper", "Compare", "Next topic →"]);
    expect(buttons[2].className).toContain("next");
    expect(buttons.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    fireEvent.click(buttons[2]);
    expect(choose).toHaveBeenCalledWith({ label: "Next topic →", next: true });
    expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays unpicked when the pick is not sent (refused, or waiting for the go-ahead)", async () => {
    const choose = vi.fn(() => false);
    await renderIn("en", <ChoicesBlock data={data} choose={choose} active />);
    fireEvent.click(screen.getByRole("button", { name: "Go deeper" }));
    expect(screen.getByRole("button", { name: "Go deeper" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("button", { name: "Compare" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Go deeper" }));
    expect(choose).toHaveBeenCalledTimes(2);
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
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getAllByRole("button").every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
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
