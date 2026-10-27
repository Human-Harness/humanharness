// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SidekickState } from "../src/client";
import { useSidekick } from "../src/sidekick/useSidekick";
import { FakeClient } from "./fake-client";
import { SK_ON } from "./sidekick-fixtures";

afterEach(cleanup);

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

  it("a new refresh key reads the state again (a restore, which main does not push)", async () => {
    const client = new FakeClient({ language: "en" });
    client.sidekickState = SK_ON;
    const { result, rerender } = renderHook(({ k }) => useSidekick(client, true, k), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current?.settings.on).toBe(true));
    client.sidekickState = { ...SK_ON, status: "off", settings: { ...SK_ON.settings, on: false } };
    rerender({ k: 1 });
    await waitFor(() => expect(result.current?.settings.on).toBe(false));
  });
});
