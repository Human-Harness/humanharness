// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsView, SetupStepView } from "../src/client";
import { SettingsPage } from "../src/SettingsPage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const STEPS: SetupStepView[] = [
  { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost: "light" },
  { id: "goal", kind: "form", label: "Your goal", required: false, form: { fields: [{ name: "goal", kind: "text", label: "Goal", optional: false, max: 200 }] } },
  { id: "ready", kind: "component", label: "Ready check", required: false, component: "ReadyStep" },
];

async function sheet(client: FakeClient) {
  const onSetup = vi.fn();
  await renderIn(
    "en",
    <SettingsPage client={client} state={client.state} tab="harness" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={onSetup} />,
  );
  return onSetup;
}

function withSteps() {
  const client = new FakeClient(configured);
  client.state = { ...client.state, setup: STEPS };
  client.setupState = { steps: { conocerte: "done", goal: "done", ready: "skipped" }, blocking: [] };
  client.setupValues = { goal: { goal: "Pass maths" } };
  return client;
}

describe("Settings › Setup (setup-steps spec §5)", () => {
  it("a harness with steps and no settings gets a Setup tab; showing it acknowledges the steps", async () => {
    const client = withSteps();
    await sheet(client);
    expect(screen.getByRole("tab", { name: "Setup" })).toBeTruthy();
    await waitFor(() => expect(client.setupCalls).toContain("acknowledge"));
  });

  it("each step with its status; interviews and components run again from the setup screen", async () => {
    const client = withSteps();
    const onSetup = await sheet(client);
    const row = (label: string) => screen.getByRole("listitem", { name: label });
    await waitFor(() => expect(within(row("Get to know you")).getByText("Done")).toBeTruthy());
    expect(within(row("Ready check")).getByText("Skipped. You can do it now.")).toBeTruthy();
    fireEvent.click(within(row("Get to know you")).getByRole("button", { name: "Do it again" }));
    expect(onSetup).toHaveBeenCalledWith("conocerte");
    fireEvent.click(within(row("Ready check")).getByRole("button", { name: "Do it now" }));
    expect(onSetup).toHaveBeenCalledWith("ready");
  });

  it("a form step edits in place, from its saved values", async () => {
    const client = withSteps();
    await sheet(client);
    const row = await screen.findByRole("listitem", { name: "Your goal" });
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const goal = (await within(row).findByLabelText("Goal")) as HTMLInputElement;
    expect(goal.value).toBe("Pass maths");
    fireEvent.change(goal, { target: { value: "Pass maths in June" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(row).findByText("Saved")).toBeTruthy();
    expect(client.setupSubmits.goal).toEqual({ goal: "Pass maths in June" });
  });

  it("a refused field keeps the form open with its reason, and no Saved", async () => {
    const client = withSteps();
    client.setupFailure = { ok: false, reason: "invalid", errors: [{ path: "goal", message: "Too long" }] };
    await sheet(client);
    const row = await screen.findByRole("listitem", { name: "Your goal" });
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    await within(row).findByLabelText("Goal");
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(row).findByText("Too long")).toBeTruthy();
    expect(within(row).queryByText("Saved")).toBeNull();
    expect(within(row).getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("not set up yet: the tab leads to the setup flow, with no step", async () => {
    const client = new FakeClient({ language: "en" });
    client.state = { ...client.state, setup: STEPS };
    const onSetup = await sheet(client);
    fireEvent.click(screen.getByRole("button", { name: /^Set up / }));
    expect(onSetup).toHaveBeenCalledWith();
  });

  it("D0: without settings or steps there is no harness tab", async () => {
    await sheet(new FakeClient(configured));
    expect(screen.queryByRole("tab", { name: "Setup" })).toBeNull();
  });

  it("D0: settings and no steps: the harness's tab as before, no Setup list, nothing acknowledged", async () => {
    const client = new FakeClient(configured);
    const view: SettingsView = {
      tab: "How I learn",
      sections: [],
      fields: [{ name: "nickname", control: "text", label: "What the app calls you", default: "", max: 40 }],
    };
    client.state = { ...client.state, settings: view };
    client.settingsState = { values: { nickname: "" }, pending: [] };
    await sheet(client);
    expect(screen.getByRole("tab", { name: "How I learn" })).toBeTruthy();
    await screen.findByLabelText("What the app calls you");
    expect(screen.queryByRole("heading", { name: "Setup" })).toBeNull();
    expect(client.setupCalls).not.toContain("acknowledge");
  });
});
