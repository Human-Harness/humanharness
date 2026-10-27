// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SidekickState } from "../src/client";
import { useSidekick } from "../src/sidekick/useSidekick";
import { FakeClient } from "./fake-client";

afterEach(cleanup);
export const SK_ON: SidekickState = {
  info: { id: "sidekick", name: "Sidekick" },
  settings: { on: true, preSend: true, wait: 6, cap: 20_000, introSeen: true },
  status: "watching",
  spent: 1200,
  cap: 20_000,
  tier: "light",
  card: null,
  week: 3400,
};

describe("useSidekick", () => {
  it("null when disabled; never asks the client", async () => {
    const client = new FakeClient({ language: "en" });
    client.sidekickState = SK_ON;
    let asked = 0;
    const get = client.sidekick.get;
    client.sidekick.get = () => (asked++, get());
    const { result } = renderHook(() => useSidekick(client, false));
    expect(result.current).toBeNull();
    expect(asked).toBe(0);
  });

  it("loads the state and follows pushes", async () => {
    const client = new FakeClient({ language: "en" });
    client.sidekickState = SK_ON;
    const { result } = renderHook(() => useSidekick(client, true));
    await waitFor(() => expect(result.current?.status).toBe("watching"));
    act(() => client.emitSidekick({ ...SK_ON, status: "reading" }));
    expect(result.current?.status).toBe("reading");
  });

  it("a push that lands before the first load wins over the stale load", async () => {
    const client = new FakeClient({ language: "en" });
    let answer: (s: SidekickState) => void = () => undefined;
    client.sidekick.get = () => new Promise((r) => (answer = r));
    const { result } = renderHook(() => useSidekick(client, true));
    act(() => client.emitSidekick({ ...SK_ON, status: "reading" }));
    await act(async () => answer(SK_ON));
    expect(result.current?.status).toBe("reading");
  });

  it("null again once disabled", async () => {
    const client = new FakeClient({ language: "en" });
    client.sidekickState = SK_ON;
    const { result, rerender } = renderHook(({ on }) => useSidekick(client, on), { initialProps: { on: true } });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ on: false });
    expect(result.current).toBeNull();
  });
});
