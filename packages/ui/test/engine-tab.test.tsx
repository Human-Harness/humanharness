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
    await screen.findByText(/Finish signing in using your browser/);
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
    expect((await screen.findByRole("alert")).textContent).toBe("Something failed and I didn't change anything.");
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
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't save this computer's AI engine settings/);
    expect(screen.getByRole("heading", { name: "Before using Claude" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so when a passed test prompt can't be recorded, and lets the user retry", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testUnrecorded = true;
    await renderIn("es", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/No pude guardar los ajustes de los motores de IA de esta computadora/);
    client.testUnrecorded = false;
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

  it("says why the test prompt failed", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testResult = { ok: false, error: { code: "out-of-quota" } };
    await renderIn("en", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/You've reached your plan's limit/);
    expect(screen.queryByRole("button", { name: "Sign in again" })).toBeNull();
  });

  it("offers to sign in again after a failed test when the CLI can't say whether it is signed in", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false, loggedIn: null };
    client.testResult = { ok: false, error: { code: "session-expired" } };
    await renderIn("en", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Your Claude session ended. Sign in again to continue.");
    client.testResult = { ok: true };
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(client.setupRuns).toEqual([{ engineId: "claude", step: "login" }]));
  });

  it("treats a test prompt that can't reach the app as a plain failure", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testError = new Error("ipc closed");
    await renderIn("en", <Tab client={client} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Something failed and I didn't change anything.");
  });

  it("offers to show or start over the shared settings file when it can't be written", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testUnrecorded = true;
    await renderIn("en", <Tab client={client} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    await waitFor(() => expect(client.sharedRevealed).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByText(/Every AI engine on this computer will ask you to accept its notice/)).toBeTruthy();
    expect(client.sharedReset).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, start over" }));
    await waitFor(() => expect(client.sharedReset).toBe(1));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.tested).toEqual(["claude", "claude"]);
  });

  it("can cancel starting over, and starts over only once while it runs", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testUnrecorded = true;
    let finish!: () => void;
    client.resetGate = new Promise((r) => (finish = r));
    await renderIn("en", <Tab client={client} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Yes, start over" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    const yes = screen.getByRole("button", { name: "Yes, start over" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await screen.findByText("Starting over…");
    expect((screen.getByRole("button", { name: "Show in Finder" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Yes, start over" })).toBeNull();
    await act(async () => finish());
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.sharedReset).toBe(1);
  });

  it("says so when starting over fails", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false };
    client.testUnrecorded = true;
    client.resetError = new Error("EACCES");
    await renderIn("es", <Tab client={client} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Restablecer" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, restablecer" }));
    await screen.findByText("No pude restablecer el archivo. Probá otra vez o miralo en Finder.");
    expect((screen.getByRole("button", { name: "Restablecer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers to sign in again when the test prompt says the session expired, even if the CLI says it is signed in", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false, loggedIn: true };
    client.testResult = { ok: false, error: { code: "session-expired" } };
    await renderIn("en", <Tab client={client} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(client.setupRuns).toEqual([{ engineId: "claude", step: "login" }]));
  });

  it("reattached to a running sign-in, waits for it before the test prompt, then tests once it ends", async () => {
    const client = withFolder();
    client.status = { ...client.status, verified: false, loggedIn: null };
    client.running = { engineId: "claude", step: "login" };
    let answer!: () => void;
    client.getSetupGate = new Promise((r) => (answer = r));
    await renderIn("en", <Tab client={client} />);
    await screen.findByRole("heading", { name: "One last check" });
    await act(async () => {});
    expect(client.tested).toEqual([]);
    await act(async () => answer());
    await screen.findByText(/Finish signing in using your browser/);
    expect(client.tested).toEqual([]);
    client.running = null;
    act(() => client.emitSetup({ kind: "end", engineId: "claude", step: "login", ok: true }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.tested).toEqual(["claude"]);
  });

  it("says when checking an engine failed, with the reason and a way to check again", async () => {
    const client = withFolder();
    client.statusError = new Error("spawn EACCES");
    await renderIn("en", <Tab client={client} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/I couldn't check Claude on this computer\./);
    expect(alert.textContent).toMatch(/spawn EACCES/);
    expect(screen.queryByText("Checking Claude on this computer…")).toBeNull();
    client.statusError = null;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
