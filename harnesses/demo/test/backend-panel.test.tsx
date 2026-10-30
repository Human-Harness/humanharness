// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { HarnessClient } from "@humanharness/ui";
import en from "../locales/en.json";
import { BackendPanel } from "../ui/BackendPanel";

afterEach(cleanup);

/** Only `client.backend`, which is all the panel touches; `emit` plays an event from the backend. */
function stubClient(call: (method: string, params?: unknown) => Promise<unknown>) {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const backend = {
    call: vi.fn(call),
    on: (event: string, cb: (data: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    },
    state: async () => "running" as const,
    onState: () => () => undefined,
    restart: async () => undefined,
  };
  const emit = (event: string, data: unknown) => {
    for (const cb of listeners.get(event) ?? []) cb(data);
  };
  return { client: { backend } as unknown as HarnessClient, backend, emit };
}

async function renderPanel(client: HarnessClient) {
  const i18n = await createI18n("en", { en });
  return render(
    <I18nextProvider i18n={i18n}>
      <BackendPanel client={client} />
    </I18nextProvider>,
  );
}

describe("BackendPanel", () => {
  it("Echo calls the backend and shows its answer with the mock flag", async () => {
    const { client, backend } = stubClient(async () => ({ echo: { text: "hello" }, mock: true }));
    await renderPanel(client);
    fireEvent.click(screen.getByRole("button", { name: "Echo" }));
    expect(await screen.findByText("hello (mock: true)")).toBeTruthy();
    expect(backend.call).toHaveBeenCalledWith("echo", { text: "hello" });
  });

  it("Stream lists the ticks it hears in order, then how many were sent", async () => {
    let answer: (v: unknown) => void = () => undefined;
    const { client, backend, emit } = stubClient(() => new Promise((resolve) => (answer = resolve)));
    await renderPanel(client);
    fireEvent.click(screen.getByRole("button", { name: "Stream" }));
    expect(backend.call).toHaveBeenCalledWith("stream", { n: 3 });
    for (const i of [0, 1, 2]) emit("tick", { i });
    answer({ sent: 3 });
    expect(await screen.findByText("sent 3")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["tick 0", "tick 1", "tick 2"]);
  });

  it("shows why a call failed", async () => {
    const { client } = stubClient(async () => {
      throw new Error("The backend isn't running");
    });
    await renderPanel(client);
    fireEvent.click(screen.getByRole("button", { name: "Echo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The backend isn't running");
  });
});
