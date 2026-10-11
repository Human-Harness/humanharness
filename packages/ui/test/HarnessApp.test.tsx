// @vitest-environment happy-dom
import { act, fireEvent, within, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { cleanup } from "@testing-library/react";
import { HarnessApp, type BlockProps } from "../src";
import { formatReset } from "../src/usage";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const Note = ({ data, respond }: BlockProps) => (
  <div>
    <h3>{data.title}</h3>
    <button onClick={() => respond(`More about ${data.title}`)}>more</button>
  </div>
);

/** Renders the app and goes from Home to the work screen, as a returning user does. */
async function startWork(ui: ReactElement) {
  const result = render(ui);
  fireEvent.click(await screen.findByRole("button", { name: /^(Start|Iniciar) Demo$/ }));
  return result;
}

describe("HarnessApp", () => {
  it("sends a message, streams the answer and renders blocks", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} blocks={{ note: Note }} />);
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
    await startWork(<HarnessApp client={client} />);
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
    await startWork(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Escribí un mensaje…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(screen.getByText(/Llegaste al límite de tu plan/)).toBeTruthy();
  });

  it("feeds state blocks to the side panel, not the chat", async () => {
    const client = new FakeClient(ready);
    await startWork(
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
    await startWork(<HarnessApp client={client} />);
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
    await startWork(<HarnessApp client={client} />);
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
    await startWork(<HarnessApp client={client} />);
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
    await startWork(<HarnessApp client={client} />);
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
    await startWork(<HarnessApp client={client} blocks={{ note: Note }} />);
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
    await startWork(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.sent).toEqual(["earlier question"]));
  });

  it("does not submit on Enter while an IME is composing", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} />);
    const input = await screen.findByPlaceholderText("Write a message…");
    fireEvent.change(input, { target: { value: "にほん" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(client.sent).toEqual([]);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["にほん"]));
  });

  it("merges the saved conversation with entries already in state", async () => {
    const client = new FakeClient(ready);
    let open!: () => void;
    client.loadChatGate = new Promise((r) => (open = r));
    client.chat = [{ id: "1", role: "user", text: "earlier question", blocks: [], activities: [], at: "t" }];
    await startWork(<HarnessApp client={client} />);
    await typeAndSend(client, "typed early");
    act(() => open());
    await screen.findByText("earlier question");
    expect(screen.getByText("typed early")).toBeTruthy();
  });

  it("disables restore while a turn is live, asks for confirmation and adds a notice", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} />);
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
    await startWork(<HarnessApp client={client} />);
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
    const { rerender } = await startWork(<HarnessApp client={client} locales={{ en: { a: "1" } }} />);
    await screen.findByPlaceholderText("Write a message…");
    rerender(<HarnessApp client={client} locales={{ en: { a: "1" } }} />);
    expect(client.getStateCalls).toBe(1);
  });

  it("falls back to the generic error for unknown error codes", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "done", ok: false, error: { code: "brand-new" as never } }));
    expect(screen.getByText("Something failed and I didn't change anything.")).toBeTruthy();
  });

  it("renders only the error card for a failed turn without text", async () => {
    const client = new FakeClient(ready);
    const { container } = await startWork(<HarnessApp client={client} />);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "done", ok: false, error: { code: "agent-crashed" } }));
    expect(container.querySelectorAll("article.hh-message.assistant").length).toBe(0);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps long answers pinned to the bottom only when the user was near it", async () => {
    const client = new FakeClient(ready);
    const { container } = await startWork(<HarnessApp client={client} />);
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
    const { container } = await startWork(<HarnessApp client={client} />);
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

  it("history is a modal dialog: focuses Close, Escape closes", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} />);
    await screen.findByPlaceholderText("Write a message…");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Home with the logo, name, tagline, Start and the engine pill", async () => {
    const client = new FakeClient(ready);
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.42, resetsAt: new Date(Date.now() + 3600_000).toISOString() }], estimates: {} };
    const { container } = render(<HarnessApp client={client} />);
    expect(await screen.findByRole("heading", { name: "Demo" })).toBeTruthy();
    expect(screen.getByText("Test notes")).toBeTruthy();
    expect(container.querySelector("svg.hh-logo")).toBeTruthy();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    const pill = await screen.findByRole("button", { name: /Claude.*Connected.*5 h · 42%/ });
    fireEvent.click(pill);
    await screen.findByRole("group", { name: "AI engines" });
  });

  it("uses the harness's own logo when it has one", async () => {
    const client = new FakeClient(ready);
    client.state.harness.logo = "data:image/svg+xml;base64,PHN2Zy8+";
    const { container } = render(<HarnessApp client={client} />);
    await screen.findByRole("heading", { name: "Demo" });
    expect(container.querySelector("img.hh-home-logo")?.getAttribute("src")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });

  it("on first launch, Start opens Settings → Engine and the work screen opens once it is set up", async () => {
    const client = new FakeClient();
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /^(Start|Iniciar) Demo$/ }));
    expect(screen.getByRole("tab", { name: /Engine|Motor/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Use this folder|Usar esta carpeta/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Use Claude|Usar Claude/ }));
    await screen.findByPlaceholderText(/Write a message|Escribí un mensaje/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.state.config).toMatchObject({ folder: "/Users/me/Documents/Demo", engineId: "claude" });
  });

  it("the gear opens Settings on General and Done goes back to Home", async () => {
    render(<HarnessApp client={new FakeClient(ready)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Start Demo" })).toBeTruthy();
  });

  it("gives focus back to the gear when Settings closes", async () => {
    render(<HarnessApp client={new FakeClient(ready)} />);
    const gear = await screen.findByRole("button", { name: "Settings" });
    gear.focus();
    fireEvent.click(gear);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(document.activeElement).toBe(gear);
  });

  it("ignores a late engine check for the engine used before", async () => {
    const client = new FakeClient(ready);
    client.state.engines = [...client.state.engines, { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    let release!: () => void;
    client.statusGates.claude = new Promise((r) => (release = r));
    client.statusFor.claude = { ...client.status, loggedIn: false };
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: /Claude.*Checking/ });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Engine" }));
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Codex" }));
    await waitFor(() => expect(client.state.config.engineId).toBe("codex"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByRole("button", { name: /Codex.*Connected/ });
    await act(async () => release());
    expect(screen.getByRole("button", { name: /Codex.*Connected/ })).toBeTruthy();
  });

  it("shows the engine as not connected when it can't be checked, and the pill still opens Settings", async () => {
    const client = new FakeClient(ready);
    client.statusError = new Error("boom");
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /Claude.*Not connected/ }));
    await screen.findByRole("group", { name: "AI engines" });
  });

  it("shows the whole folder path on hover in Home's footer", async () => {
    render(<HarnessApp client={new FakeClient(ready)} />);
    const path = await screen.findByText("/Users/me/Documents/Demo");
    expect(path.closest("[title]")?.getAttribute("title")).toBe("/Users/me/Documents/Demo");
  });

  it("shows a signed-out engine as not connected, and the pill leads to sign-in", async () => {
    const client = new FakeClient(ready);
    client.status = { ...client.status, loggedIn: false };
    render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /Claude.*Not connected/ }));
    await screen.findByRole("heading", { name: "Sign in to Claude" });
  });

  it("gives every screen a top bar the window can be dragged by", async () => {
    const dragStrip = (c: HTMLElement) => c.querySelector("header.hh-topbar");
    const failing = new FakeClient(ready);
    failing.stateError = new Error("boom");
    const loading = render(<HarnessApp client={failing} />);
    expect(dragStrip(loading.container)).toBeTruthy();
    await screen.findByRole("alert");
    expect(dragStrip(loading.container)).toBeTruthy();
    cleanup();

    const client = new FakeClient(ready);
    const { container } = render(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    // The sheet hangs under Home's top bar, which stays in place.
    expect(dragStrip(container)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Demo" }));
    await screen.findByPlaceholderText("Write a message…");
    expect(dragStrip(container)?.textContent).toContain("Demo");
  });

  it("follows the UI language in <html lang>", async () => {
    render(<HarnessApp client={new FakeClient({ ...ready, language: "es" })} />);
    await screen.findByRole("button", { name: "Iniciar Demo" });
    expect(document.documentElement.lang).toBe("es");
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await screen.findByRole("button", { name: "Start Demo" });
    expect(document.documentElement.lang).toBe("en");
  });

  const in2h = () => new Date(Date.now() + 2 * 3600_000).toISOString();
  const in4d = () => new Date(Date.now() + 4 * 86400_000).toISOString();

  it("shows Claude's plan windows in the top bar, from the log and then live", async () => {
    const client = new FakeClient(ready);
    const fiveHourReset = in2h();
    client.usage = {
      limits: [
        { kind: "five_hour", utilization: 0.16, resetsAt: fiveHourReset },
        { kind: "seven_day", utilization: 0.09, resetsAt: in4d() },
      ],
      estimates: {},
    };
    await startWork(<HarnessApp client={client} />);
    await screen.findByText(`5 h: 16% used · resets at ${formatReset(fiveHourReset, "en")} — week: 9% used`);
    act(() => client.emit({ type: "limits", status: "allowed", windows: [{ kind: "five_hour", utilization: 0.85, resetsAt: fiveHourReset }] }));
    expect(screen.getByText(/Close to your limit/)).toBeTruthy();
  });

  it("before any message, says usage shows up later", async () => {
    await startWork(<HarnessApp client={new FakeClient(ready)} />);
    await screen.findByText("Your plan's usage shows up after the first message.");
  });

  it("says when the engine doesn't report limits and shows the last reply's tokens", async () => {
    const client = new FakeClient({ ...ready, engineId: "codex" });
    client.state.engines = [{ ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    client.chat = [
      { id: "1", role: "assistant", text: "hi", blocks: [], activities: [], at: "t", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ];
    await startWork(<HarnessApp client={client} />);
    await screen.findByText(/Codex doesn't report your plan's limits\. Last message: 1\.2K tokens\./);
  });

  it("asks before a heavy action when the 5-hour window is high, and sends only on Continue", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" } };
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.75, resetsAt: in2h() }], estimates: { tidy: 0.08 } };
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
    await screen.findByText(/5 h: 75% used/);
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain('"Tidy up" usually uses about 8% of your 5-hour window. You have 25% left.');
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(client.sent).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(client.sent).toEqual(["Tidy all notes"]));
    expect(client.sentOptions).toEqual([{ action: "tidy" }]);
  });

  it("focuses Not now on the pre-flight question, scrolls to it, and Escape means not now", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" } };
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.75, resetsAt: in2h() }], estimates: { tidy: 0.08 } };
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
      await screen.findByText(/5 h: 75% used/);
      const opener = screen.getByRole("button", { name: "tidy" });
      opener.focus();
      fireEvent.click(opener);
      const dialog = await screen.findByRole("alertdialog");
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Not now" }));
      expect(scrolled).toContain(dialog);
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(client.sent).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("forgets plan windows that have already reset", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" } };
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
    await screen.findByText("Your plan's usage shows up after the first message.");
    const past = new Date(Date.now() - 60_000).toISOString();
    act(() =>
      client.emit({
        type: "limits",
        status: "allowed",
        windows: [
          { kind: "five_hour", utilization: 0.97, resetsAt: past },
          { kind: "seven_day", utilization: 0.09, resetsAt: in4d() },
        ],
      }),
    );
    expect(screen.getByText("week: 9% used")).toBeTruthy();
    expect(screen.queryByText(/Almost at your limit/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    await waitFor(() => expect(client.sent).toEqual(["Tidy all notes"]));
  });

  it("goes straight ahead with a heavy action when there is room", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" } };
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.2, resetsAt: in2h() }], estimates: {} };
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Tidy all notes", { action: "tidy" })}>tidy</button>} />);
    await screen.findByText(/5 h: 20% used/);
    fireEvent.click(screen.getByRole("button", { name: "tidy" }));
    await waitFor(() => expect(client.sent).toEqual(["Tidy all notes"]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("tells when the limit resets on an out-of-quota card", async () => {
    const client = new FakeClient(ready);
    const reset = in2h();
    client.usage = { limits: [{ kind: "five_hour", utilization: 1, resetsAt: reset }], estimates: {} };
    await startWork(<HarnessApp client={client} />);
    await screen.findByText(/5 h: 100% used/);
    await typeAndSend(client, "go");
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(screen.getByText(`Your limit resets: ${formatReset(reset, "en")}.`)).toBeTruthy();
  });

  it("shows a card for a signed-out engine whose button opens the sign-in step", async () => {
    const client = new FakeClient(ready);
    client.status = { ...client.status, loggedIn: false };
    await startWork(<HarnessApp client={client} />);
    await screen.findByText("Your Claude session ended. Sign in again to continue.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await screen.findByRole("heading", { name: "Sign in to Claude" });
  });

  it("changes engine from Settings → Engine and starts a new conversation", async () => {
    const client = new FakeClient(ready);
    client.state.engines = [...client.state.engines, { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    await startWork(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Engine" }));
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    client.switchedFrom = "claude";
    fireEvent.click(await screen.findByRole("button", { name: "Use Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("You're now using Codex, so I started a new conversation. The earlier one is saved in your folder.");
    expect(client.state.config.engineId).toBe("codex");
  });

  it("goes back Home from the work screen", async () => {
    await startWork(<HarnessApp client={new FakeClient(ready)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Home" }));
    await screen.findByRole("button", { name: "Start Demo" });
  });

  it("restores the side panel from the saved conversation", async () => {
    const client = new FakeClient(ready);
    client.chat = [{ id: "1", role: "assistant", text: "", blocks: [], activities: [], at: "t", state: { progress: { percent: 60 } } }];
    await startWork(
      <HarnessApp client={client} stateBlocks={["progress"]} renderSide={(s) => <p>Progress {(s.progress as { percent: number } | undefined)?.percent ?? 0}%</p>} />,
    );
    await screen.findByText("Progress 60%");
  });
});
