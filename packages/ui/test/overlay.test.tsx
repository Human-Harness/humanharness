// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, SidekickState, TaskView } from "../src/client";
import { SidekickButton } from "../src/sidekick/SidekickPanel";
import { Overlay } from "../src/task-view/Overlay";
import { PathButton } from "../src/task-view/PathButton";
import { useOverlay } from "../src/task-view/useOverlay";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);

function state(): AppState {
  const s = new FakeClient().state;
  s.actions = {
    a: { label: "One", cost: "medium" },
    b: { label: "Two", cost: "medium" },
    c: { label: "Three", cost: "medium" },
    d: { label: "Four", cost: "medium" },
    e: { label: "Five", cost: "medium" },
    f: { label: "Six", cost: "medium" },
  };
  s.path = ["a", "b", "c", "d", "e", "f"];
  return s;
}
const running: TaskView = { current: { id: "t1", status: "waiting", action: "a" }, actions: {}, notes: [] };

/** The chat's use of the pieces: the path on the left, Sidekick (when the harness has one) on the right. */
function Task({ taskKey, sidekick }: { taskKey: string; sidekick?: SidekickState }) {
  const ov = useOverlay(taskKey);
  return (
    <>
      <PathButton state={state()} tasks={running} name="Path" expanded={ov.open === "path"} onClick={() => ov.toggle("path")} buttonRef={ov.trigger("path")} />
      {sidekick && <SidekickButton state={sidekick} expanded={ov.open === "sidekick"} onOpen={() => ov.toggle("sidekick")} buttonRef={ov.trigger("sidekick")} />}
      <input aria-label="Composer" />
      {ov.open === "path" && (
        <Overlay side="left" name="Path" closeLabel="Close" onClose={ov.close} autoFocus={ov.focusIn}>
          <button type="button">Step one</button>
        </Overlay>
      )}
      {sidekick && ov.open === "sidekick" && (
        <Overlay side="right" name="Sidekick" closeLabel="Close" onClose={ov.close} autoFocus={ov.focusIn}>
          <p>Cards</p>
        </Overlay>
      )}
    </>
  );
}

const path = () => screen.queryByRole("complementary", { name: "Path" });
const side = () => screen.queryByRole("complementary", { name: "Sidekick" });

describe("the folded overlays", () => {
  it("on mount nothing is open; Path · 1 / 6 opens the Path region and moves focus into it", async () => {
    await renderIn("en", <Task taskKey="t1" sidekick={SK_ON} />);
    expect(path()).toBeNull();
    expect(side()).toBeNull();
    const button = screen.getByRole("button", { name: "Path · 1 / 6" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    const region = path()!;
    expect(region).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(region.contains(document.activeElement)).toBe(true);
  });

  it("opening Sidekick closes the path, and the other way round", async () => {
    await renderIn("en", <Task taskKey="t1" sidekick={SK_ON} />);
    fireEvent.click(screen.getByRole("button", { name: /^Path/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open Sidekick" }));
    expect(side()).toBeTruthy();
    expect(path()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Path/ }));
    expect(path()).toBeTruthy();
    expect(side()).toBeNull();
  });

  it("Escape closes and focus returns to the trigger; so does the close button", async () => {
    await renderIn("en", <Task taskKey="t1" sidekick={SK_ON} />);
    const button = screen.getByRole("button", { name: /^Path/ });
    fireEvent.click(button);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(path()).toBeNull();
    expect(document.activeElement).toBe(button);
    const sk = screen.getByRole("button", { name: "Open Sidekick" });
    fireEvent.click(sk);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(side()).toBeNull();
    expect(document.activeElement).toBe(sk);
  });

  it("another task starts folded", async () => {
    const { rerender, i18n } = await renderIn("en", <Task taskKey="t1" sidekick={SK_ON} />);
    fireEvent.click(screen.getByRole("button", { name: /^Path/ }));
    expect(path()).toBeTruthy();
    rerender(
      <I18nextProvider i18n={i18n}>
        <Task taskKey="t2" sidekick={SK_ON} />
      </I18nextProvider>,
    );
    expect(path()).toBeNull();
    expect(side()).toBeNull();
  });

  it("a harness with no Sidekick has no Sidekick button", async () => {
    await renderIn("en", <Task taskKey="t1" />);
    expect(screen.queryByRole("button", { name: /Sidekick/ })).toBeNull();
  });
});
