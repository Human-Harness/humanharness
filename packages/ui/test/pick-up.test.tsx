// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PickUp, pickUpItems } from "../src/PickUp";
import { renderIn } from "./render";

afterEach(cleanup);

it("takes open tasks first (waiting before working), then history, at most three (spec §5.2)", () => {
  const items = pickUpItems({
    open: [
      { id: "a", title: "Engines", state: "working", updatedAt: 2 },
      { id: "b", title: "The turn", state: "waiting", updatedAt: 1 },
    ],
    history: [
      { id: "c", title: "The manifest", outcome: "noteSaved", endedAt: 0 },
      { id: "d", title: "Old", outcome: "noteSaved", endedAt: -1 },
    ],
  });
  expect(items.map((i) => [i.title, i.tone])).toEqual([
    ["The turn", "orange"],
    ["Engines", "blue"],
    ["The manifest", "green"],
  ]);
});

it("is empty with nothing to pick up", () => {
  expect(pickUpItems({ open: [], history: [] })).toEqual([]);
});

it("renders nothing when empty, else a titled section with a count", async () => {
  const onOpen = vi.fn();
  const { container } = await renderIn("en", <PickUp items={[]} onOpen={onOpen} />);
  expect(container.innerHTML).toBe("");
  cleanup();
  await renderIn("en", <PickUp items={[{ id: "b", title: "The turn", tone: "orange", status: "Waiting for you", where: "Topic 3 of 6 · 12 min ago" }]} onOpen={onOpen} />);
  expect(screen.getByRole("heading", { name: "Pick up where you left" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /The turn/ }));
  expect(onOpen).toHaveBeenCalledWith("b");
});
