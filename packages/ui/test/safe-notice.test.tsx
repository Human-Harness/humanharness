// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeNotice } from "../src/mods/SafeNotice";
import { renderIn } from "./render";

afterEach(cleanup);

const text = "Safe mode: your mods are off and the harness's layout is shown. Turn them back on in Settings › Mods.";

describe("the safe-mode notice (minimal-core 0b2)", () => {
  it("shows when the app started in safe mode, and closes", async () => {
    await renderIn("en", <SafeNotice client={{ safeMode: vi.fn(async () => true) }} />, { theme: true });
    expect((await screen.findByRole("status")).textContent).toContain(text);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows when the escape hatch is pressed", async () => {
    let send: (() => void) | undefined;
    const onSafeMode = (fn: () => void) => {
      send = fn;
      return () => undefined;
    };
    await renderIn("en", <SafeNotice client={{ safeMode: vi.fn(async () => false), onSafeMode }} />, { theme: true });
    await act(async () => undefined);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => send!());
    expect((await screen.findByRole("status")).textContent).toContain(text);
  });

  it("nothing without the channel", async () => {
    await renderIn("en", <SafeNotice client={{}} />, { theme: true });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
