// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function startWork(ui: ReactElement) {
  const result = render(ui);
  const start = (await screen.findByRole("button", { name: /^(Start|Iniciar) Demo$/ })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  return result;
}

function scopedClient() {
  const client = new FakeClient(ready);
  client.state.scopes = { label: "topic", plural: "topics" };
  client.state.actions = { study: { label: "Study", cost: "light" } };
  client.scopeList = [
    { id: "fracciones", title: "Fractions", createdAt: "c", archived: false },
    { id: "old", title: "Old", createdAt: "c", archived: true },
  ];
  return client;
}

describe("scopes in the window", () => {
  it("picks an active scope from the top bar", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} />);
    const select = (await screen.findByRole("combobox", { name: "Choose topic" })) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.textContent)).toEqual(["No topic", "Fractions"]));
    fireEvent.change(select, { target: { value: "fracciones" } });
    await waitFor(() => expect(client.openScope).toBe("fracciones"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Choose topic" }) as HTMLSelectElement).value).toBe("fracciones"));
  });

  it("adds a scope and opens it", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "New topic" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Algebra" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(client.openScope).toBe("algebra"));
    expect(client.scopeList.map((s) => s.id)).toContain("algebra");
  });

  it("asks for a scope before a required action and sends nothing", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Study", { action: "study" })}>go</button>} />);
    fireEvent.click(await screen.findByRole("button", { name: "go" }));
    expect((await screen.findAllByText("First choose which topic to work on.")).length).toBeGreaterThan(0);
    expect(client.sent).toEqual([]);
  });

  it("reloads the chat when the open scope changes under the window (the migration opens main at startup)", async () => {
    const client = scopedClient();
    const load = vi.spyOn(client, "loadChat");
    await startWork(<HarnessApp client={client} />);
    await screen.findByRole("combobox", { name: "Choose topic" });
    await waitFor(() => expect(load).toHaveBeenCalled());
    const before = load.mock.calls.length;
    client.openScope = "fracciones";
    act(() => client.emitScopes());
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(before));
  });

  it("ignores a late first reply once a change has arrived", async () => {
    const client = scopedClient();
    let late: (id: string | null) => void = () => undefined;
    client.scopes.current = () => new Promise((r) => (late = r));
    await startWork(<HarnessApp client={client} />);
    await screen.findByRole("combobox", { name: "Choose topic" });
    client.openScope = "fracciones";
    act(() => client.emitScopes());
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Choose topic" }) as HTMLSelectElement).value).toBe("fracciones"));
    await act(async () => late(null));
    expect((screen.getByRole("combobox", { name: "Choose topic" }) as HTMLSelectElement).value).toBe("fracciones");
  });

  it("disables the picker while a turn is live", async () => {
    const client = scopedClient();
    client.openScope = "fracciones";
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Study", { action: "study" })}>go</button>} />);
    const select = (await screen.findByRole("combobox", { name: "Choose topic" })) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "go" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Choose topic" }) as HTMLSelectElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "New topic" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes the add form with Escape and returns focus to the button", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "New topic" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New topic" }));
  });

  it("shows no picker for a harness without scopes (spec D2)", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Settings" });
    expect(screen.queryByRole("combobox", { name: /^Choose / })).toBeNull();
  });
});
