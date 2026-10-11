// @vitest-environment happy-dom
import { act, fireEvent, within, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("explains a folder that can't be used, keeps the previous one, and clears the message on a good pick", async () => {
    const client = new FakeClient({ language: "es" });
    client.pickResult = { folder: "/Users/me/Documents", problem: "too-broad" };
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Elegir otra carpeta" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Esa carpeta es muy general. Elegí o creá una carpeta adentro de ella.");
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    client.pickResult = { folder: "/Users/me/Documents/Mine", problem: null };
    fireEvent.click(screen.getByRole("button", { name: "Elegir otra carpeta" }));
    await screen.findByText("/Users/me/Documents/Mine");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a message when the settings can't be saved", async () => {
    const client = new FakeClient({ language: "en" });
    client.saveError = new Error("protected");
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't save/i);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
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
    expect(screen.getAllByText("Here it is").length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restored).toEqual(["abc"]));
  });

  it("tells the user when going back failed", async () => {
    const client = new FakeClient(ready);
    client.restoreError = new Error("busy");
    render(<HarnessApp client={client} />);
    await screen.findByPlaceholderText("Write a message…");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("Turn: hi");
    fireEvent.click(screen.getByRole("button", { name: "Go back to this point" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't go back/i);
  });

  it("loads the saved conversation", async () => {
    const client = new FakeClient(ready);
    client.chat = [{ id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" }];
    render(<HarnessApp client={client} />);
    await screen.findByText("earlier question");
  });

  const typeAndSend = async (client: FakeClient, text: string) => {
    const input = (await screen.findByPlaceholderText("Write a message…")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    return input;
  };

  it("keeps the draft typed while the AI answers and does not submit it", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    const input = await typeAndSend(client, "first");
    await waitFor(() => expect(client.sent).toEqual(["first"]));
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(client.sent).toEqual(["first"]);
    expect(input.value).toBe("second");
    act(() => client.emit({ type: "done", ok: true }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.sent).toEqual(["first", "second"]));
    expect(input.value).toBe("");
  });

  it("does not let block buttons queue messages while a turn is live", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} blocks={{ note: Note }} />);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "block", name: "note", data: { title: "A" } }));
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await Promise.resolve();
    expect(client.sent).toEqual(["go"]);
  });

  it("retries the last user message found in state, even after a restart", async () => {
    const client = new FakeClient(ready);
    client.chat = [
      { id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" },
      { id: "2", role: "assistant", text: "", blocks: [], activities: [], at: "t", error: { code: "agent-crashed" } },
    ];
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.sent).toEqual(["earlier question"]));
  });

  it("does not submit on Enter while an IME is composing", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "にほん" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(client.sent).toEqual([]);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["にほん"]));
  });

  it("saves the language chosen in setup when starting", async () => {
    const client = new FakeClient({ language: "en" });
    render(<HarnessApp client={client} />);
    await screen.findByText("Let's get Demo ready");
    fireEvent.click(screen.getByRole("radio", { name: "Español" }));
    await screen.findByText("Preparemos Demo");
    fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
    await screen.findByPlaceholderText("Escribí un mensaje…");
    expect(client.state.config.language).toBe("es");
  });

  it("merges the saved conversation with entries already in state", async () => {
    const client = new FakeClient(ready);
    let open!: () => void;
    client.loadChatGate = new Promise((r) => (open = r));
    client.chat = [{ id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" }];
    render(<HarnessApp client={client} />);
    await typeAndSend(client, "typed early");
    act(() => open());
    await screen.findByText("earlier question");
    expect(screen.getByText("typed early")).toBeTruthy();
  });

  it("disables restore while a turn is live, asks for confirmation and adds a notice", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText("Turn: hi");
    expect((screen.getByRole("button", { name: "Go back to this point" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => client.emit({ type: "done", ok: true }));
    fireEvent.click(screen.getByRole("button", { name: "Go back to this point" }));
    expect(client.restored).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back to this point" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restored).toEqual(["abc"]));
    await screen.findByText("I went back to that point. Files changed after it were undone.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a translated error when the message cannot reach the main process", async () => {
    const client = new FakeClient(ready);
    client.sendError = new Error("ipc closed");
    render(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    await screen.findByText("Something failed and I didn't change anything.");
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("shows a loading state, then a translated error if the state cannot load", async () => {
    const client = new FakeClient(ready);
    client.stateError = new Error("boom");
    const { container } = render(<HarnessApp client={client} />);
    expect(container.querySelector(".hh-loading")).toBeTruthy();
    await screen.findByText(/The app couldn't start|La app no pudo arrancar/);
  });

  it("does not reload state when inline locales change identity", async () => {
    const client = new FakeClient(ready);
    const { rerender } = render(<HarnessApp client={client} locales={{ en: { a: "1" } }} />);
    await screen.findByPlaceholderText("Write a message…");
    rerender(<HarnessApp client={client} locales={{ en: { a: "1" } }} />);
    expect(client.getStateCalls).toBe(1);
  });

  it("falls back to the generic error for unknown error codes", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "done", ok: false, error: { code: "brand-new" as never } }));
    expect(screen.getByText("Something failed and I didn't change anything.")).toBeTruthy();
  });

  it("renders only the error card for a failed turn without text", async () => {
    const client = new FakeClient(ready);
    const { container } = render(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "done", ok: false, error: { code: "agent-crashed" } }));
    expect(container.querySelectorAll("article.hh-message.assistant").length).toBe(0);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps long answers pinned to the bottom only when the user was near it", async () => {
    const client = new FakeClient(ready);
    const { container } = render(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    const chat = container.querySelector(".hh-chat") as HTMLElement;
    Object.defineProperty(chat, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(chat, "clientHeight", { configurable: true, value: 400 });
    chat.scrollTop = 560;
    fireEvent.scroll(chat);
    act(() => client.emit({ type: "text", delta: "more" }));
    expect(chat.scrollTop).toBe(1000);
    chat.scrollTop = 100;
    fireEvent.scroll(chat);
    act(() => client.emit({ type: "text", delta: " and more" }));
    expect(chat.scrollTop).toBe(100);
  });

  it("is accessible: labelled composer, live region, focus management", async () => {
    const client = new FakeClient(ready);
    const { container } = render(<HarnessApp client={client} />);
    const input = (await screen.findByLabelText("Write a message…")) as HTMLTextAreaElement;
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(document.activeElement).toBe(input);
    expect(region.textContent).toBe("Working…");
    input.blur();
    act(() => {
      client.emit({ type: "text", delta: "All done" });
      client.emit({ type: "done", ok: true });
    });
    expect(region.textContent).toBe("All done");
    expect(document.activeElement).toBe(input);
    expect(within(container.querySelector(".hh-chat") as HTMLElement).getByText("All done")).toBeTruthy();
  });

  it("groups setup choices in fieldsets with legends", async () => {
    const client = new FakeClient();
    render(<HarnessApp client={client} />);
    await screen.findByText(/get Demo ready|Preparemos Demo/);
    expect(screen.getByRole("group", { name: /Language|Idioma/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /AI engine|Motor de IA/ })).toBeTruthy();
  });

  it("history is a modal dialog: focuses Close, Escape closes", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await screen.findByPlaceholderText("Write a message…");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("styles", () => {
  const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
  it("preserves single line breaks in messages", () => {
    expect(css).toMatch(/\.hh-message p\s*{[^}]*white-space:\s*pre-wrap/);
  });
  it("keeps borders at 3:1 contrast against both backgrounds in light and dark", () => {
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const [light, dark] = css.split("prefers-color-scheme: dark");
    for (const block of [light, dark]) {
      const v = (name: string) => block.match(new RegExp(`--hh-${name}:\\s*(#[0-9a-f]{6})`, "i"))![1];
      expect(ratio(v("border"), v("bg"))).toBeGreaterThanOrEqual(3);
      expect(ratio(v("border"), v("surface"))).toBeGreaterThanOrEqual(3);
    }
  });
});
