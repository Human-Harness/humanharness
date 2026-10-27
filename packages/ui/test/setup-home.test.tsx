// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { SetupStepProps, SetupStepView, SetupStepsState } from "../src/client";
import { Home } from "../src/Home";
import { StartView } from "../src/StartView";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const STEPS: SetupStepView[] = [
  { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost: "light" },
  { id: "estilo", kind: "form", label: "How the AI talks", required: false, form: { fields: [] } },
];

function withSteps(client: FakeClient) {
  client.state = { ...client.state, setup: STEPS, actions: { conocerte: { label: "Get to know you", cost: "light", setup: true }, practice: { label: "Practice", cost: "light" } } };
  return client;
}

async function home(client: FakeClient, steps: SetupStepsState | null) {
  const onStart = vi.fn();
  const onSetup = vi.fn();
  await renderIn(
    "en",
    <Home state={client.state} client={client} onChange={() => {}} status={client.status} limits={null} steps={steps} onStart={onStart} onSetup={onSetup} onSettings={() => {}} onEngine={() => {}} />,
  );
  return { onStart, onSetup };
}

describe("Home with setup steps (setup-steps spec §4)", () => {
  it("a required step not done: says which, and Set up opens the setup screen at it", async () => {
    const client = withSteps(new FakeClient(configured));
    const { onSetup, onStart } = await home(client, { steps: { conocerte: "missing", estilo: "missing" }, blocking: ["conocerte"] });
    expect(screen.getByText("One step left: Get to know you")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Demo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledWith("conocerte");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("a skippable step never blocks Start", async () => {
    const client = withSteps(new FakeClient(configured));
    const { onStart } = await home(client, { steps: { conocerte: "done", estilo: "missing" }, blocking: [] });
    fireEvent.click(screen.getByRole("button", { name: "Start Demo" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.queryByText(/One step left/)).toBeNull();
  });

  it("while the steps' state loads, Start waits", async () => {
    const client = withSteps(new FakeClient(configured));
    await home(client, null);
    expect((screen.getByRole("button", { name: "Start Demo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an engine problem comes first", async () => {
    const client = withSteps(new FakeClient(configured));
    client.status = { ...client.status, loggedIn: false };
    const { onSetup } = await home(client, { steps: {}, blocking: ["conocerte"] });
    expect(screen.queryByText("One step left: Get to know you")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledWith(undefined);
  });

  it("HarnessApp reads the steps' state and follows its changes", async () => {
    const client = withSteps(new FakeClient(configured));
    client.setupState = { steps: { conocerte: "missing" }, blocking: ["conocerte"] };
    render(<HarnessApp client={client} />);
    expect(await screen.findByText("One step left: Get to know you")).toBeTruthy();
    client.emitSetupSteps({ steps: { conocerte: "done" }, blocking: [] });
    await waitFor(() => expect(screen.queryByText("One step left: Get to know you")).toBeNull());
  });

  it("Settings' Do it now: the step alone, and its end reopens Settings on the harness's tab", async () => {
    const client = new FakeClient(configured);
    client.state = { ...client.state, setup: [{ id: "ready", kind: "component", label: "Ready check", required: false, component: "ReadyStep" }] };
    client.setupState = { steps: { ready: "skipped" }, blocking: [] };
    const ReadyStep = ({ done }: SetupStepProps) => (
      <button type="button" onClick={done}>
        All good
      </button>
    );
    render(<HarnessApp client={client} setupSteps={{ ReadyStep }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Setup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Do it now" }));
    fireEvent.click(await screen.findByRole("button", { name: "All good" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("D0: a harness without setup steps never asks for them", async () => {
    const client = new FakeClient(configured);
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    expect(client.setupCalls).toEqual([]);
  });
});

describe("StartView", () => {
  it("leaves an interview step's action out of the topics", async () => {
    const client = withSteps(new FakeClient(configured));
    await renderIn("en", <StartView state={client.state} tasks={{ current: null, actions: {}, notes: [] }} notice={null} disabled={false} onStart={() => {}} onAsk={() => {}} />);
    expect(screen.getByRole("button", { name: /Practice/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Get to know you/ })).toBeNull();
  });
});
