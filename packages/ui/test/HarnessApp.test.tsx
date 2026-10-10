// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { HarnessApp, type BlockProps } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const Note = ({ data, respond }: BlockProps) => (
  <div>
    <h3>{data.title}</h3>
    <button onClick={() => respond(`More about ${data.title}`)}>more</button>
  </div>
);

describe("HarnessApp", () => {
  it("shows the setup screen until language, folder and engine are chosen", async () => {
    const client = new FakeClient();
    render(<HarnessApp client={client} />);
    await screen.findByText(/get Demo ready|Preparemos Demo/);
    fireEvent.click(screen.getByRole("button", { name: /Start|Empezar/ }));
    await screen.findByPlaceholderText(/Write a message|Escribí un mensaje/);
    expect(client.state.config).toMatchObject({ folder: "/Users/me/Documents/Demo", engineId: "claude" });
  });

  it("lets the user pick another folder and warns about moving it", async () => {
    const client = new FakeClient({ language: "en" });
    render(<HarnessApp client={client} />);
    await screen.findByText(/Don't move, rename or edit this folder/);
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    await screen.findByText("/Users/me/Elsewhere");
  });

  it("sends a message, streams the answer and renders blocks", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} blocks={{ note: Note }} />);
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "make a note" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.sent).toEqual(["make a note"]));
    act(() => {
      client.emit({ type: "text", delta: "Here it is" });
      client.emit({ type: "block", name: "note", data: { title: "Groceries" } });
      client.emit({ type: "done", ok: true });
    });
    expect(screen.getByText("make a note")).toBeTruthy();
    expect(screen.getByText("Here it is")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Groceries" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await waitFor(() => expect(client.sent).toEqual(["make a note", "More about Groceries"]));
  });

  it("shows activity while working and a Stop button that cancels", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => client.emit({ type: "activity", id: "a", kind: "read", detail: "notes.md", state: "start" }));
    expect(screen.getByText("Reading notes.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(client.cancelled).toBe(1));
  });

  it("shows a translated error card when a turn fails", async () => {
    const client = new FakeClient({ ...ready, language: "es" });
    render(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Escribí un mensaje…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(screen.getByText(/Llegaste al límite de tu plan/)).toBeTruthy();
  });

  it("feeds state blocks to the side panel, not the chat", async () => {
    const client = new FakeClient(ready);
    render(
      <HarnessApp
        client={client}
        stateBlocks={["progress"]}
        renderSide={(s) => <p>Progress {(s.progress as { percent: number } | undefined)?.percent ?? 0}%</p>}
      />,
    );
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => client.emit({ type: "block", name: "progress", data: { percent: 40 } }));
    expect(screen.getByText("Progress 40%")).toBeTruthy();
  });

  it("lists history and restores a point", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await screen.findByPlaceholderText("Write a message…");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("Turn: hi");
    fireEvent.click(screen.getByRole("button", { name: "Go back to this point" }));
    await waitFor(() => expect(client.restored).toEqual(["abc"]));
  });

  it("loads the saved conversation", async () => {
    const client = new FakeClient(ready);
    client.chat = [{ id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" }];
    render(<HarnessApp client={client} />);
    await screen.findByText("earlier question");
  });
});
