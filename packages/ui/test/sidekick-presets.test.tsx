// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PresetOffer } from "../src/sidekick/PresetOffer";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const GUARD = { name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }], adopted: false };

it("offers the presets once; Add adopts; Not now marks them offered", async () => {
  const c = new FakeClient({ language: "en" });
  c.sidekickPresets = [GUARD, { ...GUARD, name: "Coach", personality: "" }];
  let done = 0;
  await renderIn("en", <PresetOffer client={c} onDone={() => done++} />);
  const region = await screen.findByRole("region", { name: "Suggested by the harness" });
  expect(region.textContent).toContain("Calm.");
  fireEvent.click(screen.getByRole("button", { name: "Add Guard" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["adoptPreset", "Guard"]));
  // The adopted one leaves the list; focus stays in the offer.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Add Guard" })).toBeNull());
  expect(region.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(c.sidekickCalls).toContainEqual(["set", { presetsOffered: true }]));
  await waitFor(() => expect(done).toBe(1));
});

it("D0: no presets, or all adopted → nothing shown", async () => {
  const c = new FakeClient({ language: "en" });
  const { container } = await renderIn("en", <PresetOffer client={c} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(container.textContent).toBe("");
  cleanup();
  c.sidekickPresets = [{ ...GUARD, adopted: true }];
  const again = await renderIn("en", <PresetOffer client={c} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(again.container.textContent).toBe("");
});

it("the mark shows as text unless it names the core's spark", async () => {
  const c = new FakeClient({ language: "en" });
  c.sidekickPresets = [GUARD, { ...GUARD, name: "Spark", mark: "spark" }];
  const { container } = await renderIn("en", <PresetOffer client={c} />);
  await screen.findByRole("button", { name: "Add Spark" });
  expect(container.textContent).toContain("🛡️");
  expect(container.querySelectorAll("svg.hh-sk-mark")).toHaveLength(1);
});
