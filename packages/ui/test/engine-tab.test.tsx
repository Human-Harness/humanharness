// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("shows a test engine with its own details: no sign out, plan, version or legal line", async () => {
    const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    client.state.engines = [{ ...client.state.engines[0], name: "IA simulada (mock)", provider: "Human Harness", logo: undefined, reportsLimits: false, mock: true }];
    const { container } = await renderIn("es", <Tab client={client} />);
    await screen.findByText("Grabadas en la carpeta mock/ del harness");
    const rows = [...container.querySelectorAll(".hh-row")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ["Modelo", "Modelo de prueba"],
      ["Respuestas", "Grabadas en la carpeta mock/ del harness"],
      ["Tus datos", "No salen de esta compu"],
      ["Tu plan", "No gasta nada"],
    ]);
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector(".hh-tab > .hh-caption")).toBeNull();
    // No logo: the tile draws the generic screen icon instead.
    const tile = screen.getByRole("button", { name: /IA simulada \(mock\)/ });
    expect(tile.querySelector("img")).toBeNull();
    expect(tile.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("in the setup flow, has no Use button and reports the selected engine and its readiness", async () => {
    const client = withFolder();
    addCodex(client);
    client.statusFor.codex = { ...client.status, engineId: "codex", loggedIn: false };
    const onSelection = vi.fn();
    await renderIn("en", <EngineTab client={client} state={client.state} onChange={() => {}} setup onSelection={onSelection} />);
    await screen.findByText("Claude is ready ✓");
    expect(screen.queryByRole("button", { name: "Use Claude" })).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith("claude", true);
    fireEvent.click(screen.getByRole("button", { name: /Codex/ }));
    await screen.findByRole("heading", { name: "Sign in to Codex" });
    expect(onSelection).toHaveBeenLastCalledWith("codex", false);
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
    client.setupResult = { ok: false, timedOut: true };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await screen.findByText("Installing… this can take a minute.");
    act(() => client.emitSetup({ kind: "line", text: "Downloading…" }));
    await act(async () => finish());
    expect((await screen.findByRole("alert")).textContent).toBe("This took too long, so I stopped it. Try again.");
    expect(screen.getByText("Downloading…")).toBeTruthy();
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
    // Starting over forgets the notice: nothing is sent to the engine before it is accepted again.
    await screen.findByRole("heading", { name: "Before using Claude" });
    expect(client.tested).toEqual(["claude"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(client.tested).toEqual(["claude", "claude"]);
  });

  it("offers to install by hand: copy the command, open Terminal, then check again", async () => {
    const client = withFolder();
    client.status = { ...client.status, installed: false };
    await renderIn("en", <Tab client={client} />);
    await screen.findByRole("heading", { name: "Install Claude" });
    const steps = screen.getByRole("list", { name: "Install it yourself" });
    expect([...steps.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Open Terminal.",
      "Paste the command and press Enter.",
      'When it finishes, come back here and press "I installed it, check again".',
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await screen.findByText("Copied");
    expect(client.copied).toEqual(["claude"]);
    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));
    await waitFor(() => expect(client.terminalOpened).toBe(1));
    // Nothing was run for the user.
    expect(client.setupRuns).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "I installed it, check again" }));
    await screen.findByText("I still can't find Claude. If Terminal showed an error, try the official instructions.");
    client.status = { ...client.status, installed: true };
    fireEvent.click(screen.getByRole("button", { name: "I installed it, check again" }));
    await screen.findByRole("button", { name: "Use Claude" });
  });

  it("when the automatic install fails, leads with installing by hand", async () => {
    const client = withFolder();
    client.status = { ...client.status, installed: false };
    client.setupResult = { ok: false };
    await renderIn("es", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Instalar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("La instalación automática no funcionó. Podés instalarlo vos en un minuto:");
    expect(screen.getByRole("button", { name: "Copiar comando" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir Terminal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Instrucciones oficiales" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("says so when the command can't be copied", async () => {
    const client = withFolder();
    client.status = { ...client.status, installed: false };
    client.copyError = new Error("clipboard");
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy command" }));
    await screen.findByText("I couldn't copy it. Select the command above and copy it.");
  });

  it("for an engine without an install command, links the instructions and checks again", async () => {
    const client = withFolder();
    client.state.engines = [{ ...client.state.engines[0], installCommand: undefined }];
    client.status = { ...client.status, installed: false };
    await renderIn("en", <Tab client={client} />);
    await screen.findByText(/I can't install Claude myself/);
    expect(screen.getByRole("link", { name: "Official instructions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    client.status = { ...client.status, installed: true };
    fireEvent.click(screen.getByRole("button", { name: "I installed it, check again" }));
    await screen.findByRole("button", { name: "Use Claude" });
  });

  it("shows no error when the user cancels a step", async () => {
    const client = withFolder();
    client.status = { ...client.status, installed: false };
    client.setupResult = { ok: false, cancelled: true };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await waitFor(() => expect(client.setupRuns).toHaveLength(1));
    await screen.findByRole("button", { name: "Install" });
    expect(screen.queryByRole("alert")).toBeNull();
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
    await screen.findByRole("heading", { name: "Before using Claude" });
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
    // A later failure to save is a new problem: the old reset error goes away.
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(client.tested).toEqual(["claude", "claude"]));
    await screen.findByText(/No pude guardar los ajustes de los motores de IA/);
    expect(screen.queryByText("No pude restablecer el archivo. Probá otra vez o miralo en Finder.")).toBeNull();
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
    client.statusError = new Error("Error invoking remote method 'hh:engineStatus': Error: spawn EACCES");
    await renderIn("en", <Tab client={client} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/I couldn't check Claude on this computer\./);
    // The raw reason, without Electron's English wrapper, is under Details.
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("spawn EACCES")).toBeTruthy();
    expect(alert.textContent).not.toMatch(/invoking remote method/);
    expect(screen.queryByText("Checking Claude on this computer…")).toBeNull();
    client.statusError = null;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByRole("button", { name: "Use Claude" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
