// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../../../ui/src";
import { FakeClient } from "../../../ui/test/fake-client";
import { SK_ON } from "./sidekick-fixtures";
import { render } from "./sidekick-app";

afterEach(cleanup);

/** The task view with Sidekick on, its toggle in the task bar through the mod's slot (moved from Home's meter-pills). */
async function openTask() {
  const c = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  c.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "coach" };
  c.sidekickState = SK_ON;
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("button", { name: "Sidekick is on. Turn it off" });
}

describe("the meter pills", () => {
  it("the Sidekick toggle is a pill with a state dot", async () => {
    await openTask();
    const toggle = screen.getByRole("button", { name: "Sidekick is on. Turn it off" });
    expect(toggle.className).toContain("hh-pill");
    expect(toggle.querySelector(".hh-dot")).toBeTruthy();
  });
});
