// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp, type HarnessClient, useBackend } from "../src";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const FAILED = "The harness's helper stopped working.";

function withBackend(state: "starting" | "running" | "failed" = "running") {
  const client = new FakeClient(ready);
  client.state.hatches = { backend: true };
  client.backendState = state;
  return client;
}

/** A harness view as an author writes it: the state, a call and one event. */
function Echo({ client }: { client: HarnessClient }) {
  const { state, call, on } = useBackend(client);
  const [answer, setAnswer] = useState<unknown>(null);
  const [tick, setTick] = useState<unknown>(null);
  useEffect(() => on("tick", setTick), [on]);
  return (
    <div>
      <p>state: {state ?? "unknown"}</p>
      <button onClick={() => void call("echo", { text: "hi" }).then(setAnswer)}>Echo</button>
      <p>answer: {JSON.stringify(answer)}</p>
      <p>tick: {JSON.stringify(tick)}</p>
    </div>
  );
}

describe("the backend in the window (hatches spec §4.3)", () => {
  it("D0: no card and no listener without state.hatches.backend", async () => {
    const client = new FakeClient(ready);
    const onState = vi.spyOn(client.backend, "onState");
    const stateCall = vi.spyOn(client.backend, "state");
    client.backendState = "failed";
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(onState).not.toHaveBeenCalled();
    expect(stateCall).not.toHaveBeenCalled();
    expect(client.backend.restart).not.toHaveBeenCalled();
  });

  it("failed shows the card; Restart calls restart and shows Restarting… until running", async () => {
    const client = withBackend("failed");
    // Main answers Restart before the backend is up again: the state change comes later.
    client.backend.restart.mockImplementation(async () => undefined);
    render(<HarnessApp client={client} />);
    const card = await screen.findByRole("alert");
    expect(card.textContent).toContain(FAILED);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(client.backend.restart).toHaveBeenCalledTimes(1);
    const busy = (await screen.findByRole("button", { name: "Restarting…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    act(() => client.backendStateSet("starting"));
    expect(screen.queryByText(FAILED)).toBeNull();
    act(() => client.backendStateSet("running"));
    expect(screen.queryByRole("alert")).toBeNull();
    // It fails again: the card is back with a fresh Restart.
    act(() => client.backendStateSet("failed"));
    expect((screen.getByRole("button", { name: "Restart" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a Restart that fails gives the button back", async () => {
    const client = withBackend("failed");
    client.backend.restart.mockImplementation(async () => {
      throw new Error("no");
    });
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
    const again = (await screen.findByRole("button", { name: "Restart" })) as HTMLButtonElement;
    await waitFor(() => expect(again.disabled).toBe(false));
    expect(screen.getByText(FAILED)).toBeTruthy();
  });

  it("starting and running show nothing", async () => {
    for (const s of ["starting", "running"] as const) {
      const client = withBackend(s);
      const stateCall = vi.spyOn(client.backend, "state");
      render(<HarnessApp client={client} />);
      await screen.findByRole("button", { name: "Start Demo" });
      await waitFor(() => expect(stateCall).toHaveBeenCalled());
      expect(screen.queryByText(FAILED)).toBeNull();
      cleanup();
    }
    // A crash restart passes through starting: no card in between.
    const client = withBackend("running");
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.backendStateSet("starting"));
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("useBackend gives state, call and on to a harness view", async () => {
    const client = withBackend("starting");
    client.backendAnswers = { echo: { text: "hi" } };
    await renderIn("en", <Echo client={client} />);
    await screen.findByText("state: starting");
    act(() => client.backendStateSet("running"));
    expect(screen.getByText("state: running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Echo" }));
    await screen.findByText('answer: {"text":"hi"}');
    expect(client.backendCalls).toEqual([["echo", { text: "hi" }]]);
    act(() => client.backendEmit("tick", { n: 1 }));
    expect(screen.getByText('tick: {"n":1}')).toBeTruthy();
    act(() => client.backendEmit("other", { n: 2 }));
    expect(screen.getByText('tick: {"n":1}')).toBeTruthy();
  });

  it("useBackend keeps a state change that arrives before the first answer", async () => {
    const client = withBackend("starting");
    let answer: (s: "starting") => void = () => undefined;
    vi.spyOn(client.backend, "state").mockImplementation(() => new Promise((r) => (answer = r)));
    await renderIn("en", <Echo client={client} />);
    act(() => client.backendStateSet("running"));
    await act(async () => answer("starting"));
    expect(screen.getByText("state: running")).toBeTruthy();
  });

  it("client.backend has exactly call, on, state, onState, restart (B4)", () => {
    expect(Object.keys(new FakeClient().backend).sort()).toEqual(["call", "on", "onState", "restart", "state"]);
  });
});
