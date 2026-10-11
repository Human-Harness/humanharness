// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState } from "../src/client";
import { EngineTab } from "../src/EngineTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

/** The tab with its state lifted, as the sheet holds it. */
function Tab({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <EngineTab client={client} state={state} onChange={setState} />;
}

const withFolder = () => new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
const addCodex = (client: FakeClient) => {
  client.state.engines = [...client.state.engines, { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
};

describe("EngineTab", () => {
  it("asks for the folder first, explains a folder that can't be used, then saves it with the language", async () => {
    const client = new FakeClient({});
    client.pickResult = { folder: "/Users/me/Documents", problem: "too-broad" };
    await renderIn("en", <Tab client={client} />);
    expect(screen.getByText(/works with an AI plan you already have/)).toBeTruthy();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That folder is too general. Pick or create a folder inside it.");
    client.pickResult = { folder: "/Users/me/Documents/Mine", problem: null };
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    await screen.findByText("/Users/me/Documents/Mine");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await screen.findByRole("group", { name: "AI engines" });
    expect(client.state.config).toEqual({ language: "en", folder: "/Users/me/Documents/Mine" });
  });

  it("says when the folder can't be saved", async () => {
    const client = new FakeClient({});
    client.saveError = new Error("protected");
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't save/i);
  });

  it("walks a new engine through the notice, install, sign-in and the test prompt", async () => {
    const client = withFolder();
    client.status = { ...client.status, noticeAccepted: false, installed: false, loggedIn: false, verified: false };
    await renderIn("en", <Tab client={client} />);

    await screen.findByRole("heading", { name: "Before using Claude" });
    expect(screen.getByRole("button", { name: /Claude/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/This app is not made or endorsed by Anthropic/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Anthropic terms" }).getAttribute("href")).toBe("https://example.com/terms");
    const accept = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and accept" }));
    fireEvent.click(accept);

    await screen.findByRole("heading", { name: "Install Claude" });
    expect(screen.getByText("curl -fsSL https://claude.ai/install.sh | bash")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Claude" }));
    await waitFor(() => expect(client.state.config.engineId).toBe("claude"));

    expect(client.accepted).toEqual(["claude"]);
    expect(client.setupRuns).toEqual([
      { engineId: "claude", step: "install" },
      { engineId: "claude", step: "login" },
    ]);
    expect(client.tested).toEqual(["claude"]);
  });

  it("while signing in, links the page the CLI printed and passes a pasted code", async () => {
    const client = withFolder();
    client.status = { ...client.status, loggedIn: false };
    let finish!: () => void;
    client.setupGate = new Promise((r) => (finish = r));
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByText(/Finish signing in on your browser/);
    act(() => {
      client.emitSetup({ kind: "line", text: "Opening browser…" });
      client.emitSetup({ kind: "url", url: "https://claude.ai/oauth/authorize?x=1" });
    });
    expect(screen.getByRole("link", { name: "Open the sign-in page" }).getAttribute("href")).toBe("https://claude.ai/oauth/authorize?x=1");
    expect(screen.getByText("Opening browser…")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("If the page shows a code, paste it here"), { target: { value: " abc123 " } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(client.setupInputs).toEqual(["abc123"]));
    await act(async () => finish());
    await screen.findByRole("button", { name: "Use Claude" });
  });

  it("offers to try the test prompt again when it fails", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testResult = { ok: false, error: { code: "agent-crashed" } };
    await renderIn("en", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
    client.testResult = { ok: true };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.tested).toEqual(["claude", "claude"]);
  });

  it("shows the engine in use with its details, and signs out on request", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    await renderIn("en", <Tab client={client} />);
    await screen.findByText("Claude is ready ✓");
    expect(screen.getByText("Pro plan")).toBeTruthy();
    expect(screen.getByText("USA")).toBeTruthy();
    expect(screen.getByText("2.1.296")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Claude.*Connected.*In use/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in to Claude" });
    expect(client.setupRuns).toEqual([{ engineId: "claude", step: "logout" }]);
  });

  it("switches to another ready engine and shows the coming-soon tile", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    addCodex(client);
    await renderIn("en", <Tab client={client} />);
    expect(screen.getByText("More engines · coming soon")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Codex" }));
    await waitFor(() => expect(client.state.config.engineId).toBe("codex"));
  });

  it("says clearly when the shared settings in ~/.humanharness can't be written", async () => {
    const client = withFolder();
    client.status = { ...client.status, noticeAccepted: false };
    client.acceptError = new Error("engines.json has an unknown format; not overwriting it");
    await renderIn("en", <Tab client={client} />);
    await screen.findByRole("heading", { name: "Before using Claude" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't save the shared settings in ~\/\.humanharness/);
    expect(screen.getByRole("heading", { name: "Before using Claude" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so when a passed test prompt can't be recorded, and lets the user retry", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testError = new Error("engines.json is damaged; not overwriting it");
    await renderIn("es", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/No pude guardar la configuración compartida en ~\/\.humanharness/);
    client.testError = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "Usar Claude" });
  });

  it("shows a step that timed out as failed, with a retry", async () => {
    const client = withFolder();
    client.status = { ...client.status, installed: false };
    let finish!: () => void;
    client.setupGate = new Promise((r) => (finish = r));
    client.setupResult = { ok: false };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await screen.findByText("Installing… this can take a minute.");
    act(() => client.emitSetup({ kind: "line", text: "Stopped: this took too long." }));
    await act(async () => finish());
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't work. Try again.");
    expect(screen.getByText("Stopped: this took too long.")).toBeTruthy();
    client.setupGate = null;
    client.setupResult = { ok: true };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.setupRuns.map((r) => r.step)).toEqual(["install", "install"]);
  });
});
