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
  it("offers each option as a radio in a radiogroup and hands the pick over", async () => {
    const choose = vi.fn(() => true);
    await renderIn("en", <ChoicesBlock data={data} choose={choose} active />);
    const group = screen.getByRole("radiogroup", { name: "How do we continue?" });
    const radios = within(group).getAllByRole("radio");
    expect(screen.queryByRole("button")).toBeNull();
    expect(radios.map((r) => r.textContent)).toEqual(["Go deeper", "Compare", "Next topic →"]);
    expect(radios.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    fireEvent.click(radios[2]);
    expect(choose).toHaveBeenCalledWith({ label: "Next topic →", next: true });
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect((radios[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays unpicked when the pick is not sent (refused, or waiting for the go-ahead)", async () => {
    const choose = vi.fn(() => false);
    await renderIn("en", <ChoicesBlock data={data} choose={choose} active />);
    fireEvent.click(screen.getByRole("radio", { name: "Go deeper" }));
    expect(screen.getByRole("radio", { name: "Go deeper" }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("radio", { name: "Compare" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Go deeper" }));
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
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
  });

  it("moves the focus with the arrows and never picks by moving", async () => {
    const choose = vi.fn(() => true);
    await renderIn("en", <ChoicesBlock data={data} choose={choose} active />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[1]);
    expect(choose).not.toHaveBeenCalled();
  });
});

describe("ChoicesBlock in the soft-cards look (UI refresh spec §5.1)", () => {
  it("outlines the option that moves along the path as the recommended one, and only that one", async () => {
    await renderIn("en", <ChoicesBlock data={data} choose={() => true} active />);
    expect(screen.getByRole("radio", { name: "Next topic →" }).getAttribute("data-recommended")).toBe("true");
    expect(screen.getByRole("radio", { name: "Go deeper" }).hasAttribute("data-recommended")).toBe(false);
    expect(screen.getByRole("radio", { name: "Compare" }).hasAttribute("data-recommended")).toBe(false);
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
