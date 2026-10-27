// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import { type AppState, type SetupStepProps, type SetupStepView, type SetupStepsState, isConfigured } from "../src/client";
import { systemLanguage } from "../src/language";
import { SetupFlow, type SetupFlowProps } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

/** The flow with its state kept, as HarnessApp keeps it. */
function Flow({
  client,
  onCancel = () => {},
  onStart = () => {},
  ...rest
}: { client: FakeClient; onCancel?: () => void; onStart?: () => void } & Partial<Pick<SetupFlowProps, "startAt" | "only" | "components">>) {
  const [state, setState] = useState<AppState>(client.state);
  return <SetupFlow client={client} state={state} onChange={setState} onCancel={onCancel} onStart={onStart} {...rest} />;
}

const next = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
const steps = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");

describe("SetupFlow", () => {
  it("walks a fresh app from the folder to the engine to All set, then starts", async () => {
    const client = new FakeClient();
    const onStart = vi.fn();
    await renderIn("en", <Flow client={client} onStart={onStart} />);
    expect(screen.getByRole("banner").textContent).toContain("Set up Demo");
    const folderHeading = screen.getByRole("heading", { name: "Where should we keep your work?" });
    expect(document.activeElement).toBe(folderHeading);
    expect(steps()[0].getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText(/works with an AI plan you already have, using your own account\. The app/)).toBeNull();
    // Next sits in the footer next to Cancel, as on the engine step; the folder step has no button of its own.
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("button", { name: "Next" })).toBe(next());
    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.click(next());
    const engineHeading = await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    expect(client.state.config).toEqual({ language: systemLanguage(), folder: "/Users/me/Documents/Demo" });
    expect(document.activeElement).toBe(engineHeading);
    expect(steps()[0].querySelector("svg")).toBeTruthy();
    expect(steps()[1].getAttribute("aria-current")).toBe("step");
    // Settings' own "Use Claude" isn't shown: Next does that.
    expect(screen.queryByRole("button", { name: "Use Claude" })).toBeNull();

    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    const done = await screen.findByRole("heading", { name: "All set" });
    expect(document.activeElement).toBe(done);
    expect(client.state.config.engineId).toBe("claude");
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("You can change all of this whenever you like in Settings.")).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start Demo" });
    expect(start.className).toBe("hh-primary hh-start");
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("skips the folder step when a folder is saved, and Cancel goes back", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} onCancel={onCancel} />);
    expect(screen.getByRole("heading", { name: "Which AI does Demo use?" })).toBeTruthy();
    expect(steps()[0].querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Cancel on the folder step goes back without saving", async () => {
    const client = new FakeClient();
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(client.state.config).toEqual({});
  });

  it("Back returns to the folder step when it was shown", async () => {
    const client = new FakeClient();
    await renderIn("en", <Flow client={client} />);
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Where should we keep your work?" })).toBeTruthy();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
  });

  it("enables Next only once the selected engine is ready", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    let release!: () => void;
    client.statusGates.claude = new Promise((r) => (release = r));
    client.status = { ...client.status, loggedIn: false };
    await renderIn("en", <Flow client={client} />);
    expect(next().disabled).toBe(true);
    await act(async () => release());
    await screen.findByRole("heading", { name: "Sign in to Claude" });
    expect(next().disabled).toBe(true);
    fireEvent.click(next());
    expect(screen.queryByRole("heading", { name: "All set" })).toBeNull();
  });

  it("says so when the engine can't be saved, and stays on the step", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    client.saveError = new Error("EACCES");
    fireEvent.click(next());
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't save the engine. Try again.");
    expect(screen.getByRole("heading", { name: "Which AI does Demo use?" })).toBeTruthy();
  });

  it("keeps Back off while the engine is being saved, so the flow can't jump from the folder step", async () => {
    const client = new FakeClient();
    await renderIn("en", <Flow client={client} />);
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    await waitFor(() => expect(next().disabled).toBe(false));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const save = client.saveConfig.bind(client);
    client.saveConfig = async (patch) => {
      await gate;
      return save(patch);
    };
    fireEvent.click(next());
    const back = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(next().disabled).toBe(true);
    await act(async () => release());
    await screen.findByRole("heading", { name: "All set" });
  });

  it("does not save the engine again when it is already the saved one", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    client.saveError = new Error("should not save");
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
  });

  it("saves the system language when a folder and engine are saved but the language is missing", async () => {
    const client = new FakeClient({ folder: "/Users/me/Documents/Demo", engineId: "claude" });
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
    expect(client.state.config.language).toBe(systemLanguage());
    expect(isConfigured(client.state.config)).toBe(true);
  });

  it("in mock mode, explains the single test engine and names its model at the end", async () => {
    const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo" });
    client.state = {
      ...client.state,
      mock: true,
      engines: [{ ...client.state.engines[0], name: "Mock AI", provider: "Human Harness", logo: undefined, reportsLimits: false, mock: true }],
    };
    await renderIn("en", <Flow client={client} />);
    expect(screen.getByRole("banner").textContent).toContain("Test mode (no AI)");
    expect(screen.getByText(/In test mode there is only one engine/)).toBeTruthy();
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
    expect(screen.getByText("Mock AI · Test model")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Demo" })).toBeTruthy();
  });
});

const STEPS: SetupStepView[] = [
  {
    id: "estilo",
    kind: "form",
    label: "How the AI talks",
    description: "Pick how it sounds.",
    required: false,
    form: { fields: [{ name: "tone", kind: "choice", label: "Tone", optional: false, options: ["patient", "demanding"], optionLabels: { patient: "Patient", demanding: "Demanding" } }] },
  },
  { id: "ready", kind: "component", label: "Ready check", required: true, component: "ReadyStep" },
];
const ReadyStep = ({ done }: SetupStepProps) => (
  <button type="button" onClick={done}>
    All good
  </button>
);
const withSteps = (client: FakeClient) => {
  client.state = { ...client.state, setup: STEPS };
  client.setupState = { steps: { estilo: "missing", ready: "missing" }, blocking: ["ready"] };
  client.setupValues = { estilo: { tone: "patient" } };
  return client;
};

describe("SetupFlow: the harness's own steps (setup-steps spec §4)", () => {
  it("after the engine: each step not done, in order, in the stepper; a form, a component, then All set", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" }));
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    // A saved folder: its step shows as done (a check mark, no number), as today.
    expect(steps().map((li) => li.textContent)).toEqual(["Your folder", "2AI engine", "3How the AI talks", "4Ready check"]);
    fireEvent.click(next());
    const form = await screen.findByRole("heading", { name: "How the AI talks" });
    expect(document.activeElement).toBe(form);
    expect(screen.getByText("Pick how it sounds.")).toBeTruthy();
    expect(steps()[2].getAttribute("aria-current")).toBe("step");
    // The form starts from the saved values, and the option labels show.
    expect(((await screen.findByRole("radio", { name: "Patient" })) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Demanding" }));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Ready check" });
    expect(client.setupSubmits.estilo).toEqual({ tone: "demanding" });
    // Required: no Skip; a component step has no Next of its own.
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "How the AI talks" });
    fireEvent.click(await screen.findByRole("radio", { name: "Demanding" }));
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: "All good" }));
    await screen.findByRole("heading", { name: "All set" });
    await waitFor(() => expect(client.setupCalls).toContain("finish"));
    expect(client.setupCalls.filter((c) => c.startsWith("complete:"))).toEqual(["complete:ready"]);
  });

  it("Back from the first harness step goes to the engine", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "How the AI talks" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Which AI does Demo use?" });
  });

  it("Skip on a skippable step; the steps done or skipped before are not offered again", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "How the AI talks" });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByRole("heading", { name: "Ready check" });
    expect(client.setupCalls).toContain("skip:estilo");
    cleanup();
    client.setupState = { steps: { estilo: "skipped", ready: "missing" }, blocking: ["ready"] };
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(steps().map((li) => li.textContent)).toEqual(["Your folder", "2AI engine", "3Ready check"]));
  });

  it("from Home: opens at the step, the core steps marked done; its Back is Cancel", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} startAt="ready" onCancel={onCancel} components={{ ReadyStep }} />);
    await screen.findByRole("heading", { name: "Ready check" });
    await waitFor(() => expect(steps().map((li) => li.textContent)).toEqual(["Your folder", "AI engine", "3Ready check"]));
    expect(steps()[0].querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("only one step (Settings' Do it again): its end goes back, with no All set", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    client.setupState = { steps: { estilo: "done", ready: "done" }, blocking: [] };
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} startAt="ready" only onCancel={onCancel} components={{ ReadyStep }} />);
    expect(steps().map((li) => li.textContent)).toEqual(["1Ready check"]);
    fireEvent.click(await screen.findByRole("button", { name: "All good" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(client.setupCalls).not.toContain("finish");
  });

  it("a refused form shows why and stays; a component the harness didn't register says so", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    client.setupFailure = { ok: false, reason: "invalid", errors: [{ path: "", message: "Not now" }] };
    await renderIn("en", <Flow client={client} startAt="estilo" />);
    await screen.findByRole("radio", { name: "Patient" });
    fireEvent.click(next());
    expect(await screen.findByText("Not now")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How the AI talks" })).toBeTruthy();
    client.setupFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("This step can't be shown. Skip it, or update the app.")).toBeTruthy();
  });

  it("a refusal with no field errors (setup.json can't be saved) says it didn't go through", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    client.setupFailure = { ok: false, reason: "not-ready" };
    await renderIn("en", <Flow client={client} startAt="estilo" components={{ ReadyStep }} />);
    await screen.findByRole("radio", { name: "Patient" });
    fireEvent.click(next());
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
    cleanup();
    await renderIn("en", <Flow client={client} startAt="estilo" components={{ ReadyStep }} />);
    await screen.findByRole("radio", { name: "Patient" });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't go through. Try again.");
    expect(screen.getByRole("heading", { name: "How the AI talks" })).toBeTruthy();
  });

  it("a fresh folder: the steps' state is read once the folder is chosen, not before", async () => {
    const client = withSteps(new FakeClient({ language: "en" }));
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    expect(client.setupCalls).toEqual([]);
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Which AI does Demo use?" });
    await waitFor(() => expect(client.setupCalls).toEqual(["get"]));
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "How the AI talks" });
  });

  it("D0: without setup steps the flow never asks for them", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
    expect(client.setupCalls).toEqual([]);
  });
});

describe("HarnessApp and the setup steps", () => {
  const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

  it("Home's Set up opens the setup screen at the missing step", async () => {
    const client = withSteps(new FakeClient(ready));
    render(<HarnessApp client={client} setupSteps={{ ReadyStep }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up Demo" }));
    await screen.findByRole("heading", { name: "Ready check" });
    fireEvent.click(screen.getByRole("button", { name: "All good" }));
    await screen.findByRole("heading", { name: "All set" });
  });

  it("a new folder: Start waits for that folder's steps", async () => {
    const drive = "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive";
    const client = withSteps(new FakeClient(ready));
    client.setupState = { steps: { estilo: "done", ready: "done" }, blocking: [] };
    client.state.backup = { status: { kind: "local" }, locations: [{ provider: "google-drive", path: drive, suggested: `${drive}/Demo` }] };
    client.moveResult = { ok: true, state: { ...client.state, config: { ...ready, folder: `${drive}/Demo` } } };
    render(<HarnessApp client={client} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    let release!: (s: SetupStepsState) => void;
    client.setupSteps.get = () => new Promise<SetupStepsState>((r) => (release = r));
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    await waitFor(() => expect(client.moved).toEqual([`${drive}/Demo`]));
    await waitFor(() => expect((screen.getByRole("button", { name: "Start Demo" }) as HTMLButtonElement).disabled).toBe(true));
    await act(async () => release({ steps: { estilo: "done", ready: "done" }, blocking: [] }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Start Demo" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
