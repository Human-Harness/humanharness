// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionCost } from "@humanharness/harness-sdk";
import type { AppState, SetupStepView } from "../src/client";
import { SetupFlow } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

function interviewClient(cost: ActionCost = "medium") {
  const client = new FakeClient(configured);
  const step: SetupStepView = { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost };
  client.state = { ...client.state, setup: [step], actions: { conocerte: { label: "Get to know you", cost, setup: true } } };
  client.setupState = { steps: { conocerte: "missing" }, blocking: ["conocerte"] };
  return client;
}

function Flow({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <SetupFlow client={client} state={state} onChange={setState} onCancel={() => {}} onStart={() => {}} startAt="conocerte" />;
}

describe("an interview step (setup-steps spec §3 `interview`)", () => {
  it("a slim chat: no top bar of its own, no topics; Start sends the action; the cost caption when it isn't light", async () => {
    const client = interviewClient();
    await renderIn("en", <Flow client={client} />);
    await screen.findByRole("heading", { name: "Get to know you" });
    expect(screen.getByText("This conversation uses some of your AI plan.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(client.sent).toEqual(["Get to know you"]));
    expect(client.sentOptions[0]).toEqual({ action: "conocerte" });
  });

  it("a heavy interview's caption", async () => {
    await renderIn("en", <Flow client={interviewClient("heavy")} />);
    expect(await screen.findByText("This conversation uses a good part of your AI plan.")).toBeTruthy();
  });

  it("no composer while the interview's task isn't on screen: nothing free can be sent from the setup screen", async () => {
    await renderIn("en", <Flow client={interviewClient()} />);
    await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("another action's task left open: Start shows, and Next completes without closing that task", async () => {
    const client = interviewClient();
    client.state = { ...client.state, actions: { ...client.state.actions, other: { label: "Other", cost: "light" } } };
    client.tasks = { current: { id: "t9", action: "other", status: "waiting" }, actions: {}, notes: [] };
    await renderIn("en", <Flow client={client} />);
    expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    const next = screen.getByRole("button", { name: "Next" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await screen.findByRole("heading", { name: "All set" });
    expect(client.taskCalls).toEqual([]);
    expect(client.setupCalls).toContain("complete:conocerte");
  });

  it("a pick that would move the interview to another action does nothing; a follow-up still goes", async () => {
    const client = interviewClient();
    client.state = { ...client.state, actions: { ...client.state.actions, other: { label: "Other", cost: "light" } } };
    client.tasks = { current: { id: "t1", action: "conocerte", status: "waiting" }, actions: {}, notes: [] };
    const options = [
      { label: "Something else", action: "other" },
      { label: "Tell me more", followUp: "More please" },
    ];
    client.chat = [
      { id: "u1", role: "user", text: "Get to know you", blocks: [], activities: [], at: "t", task: "t1", action: "conocerte" },
      { id: "a1", role: "assistant", text: "Hi.", blocks: [{ name: "choices", data: { options } }], activities: [], at: "t", task: "t1" },
    ];
    await renderIn("en", <Flow client={client} />);
    expect(await screen.findByRole("textbox")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Something else" }));
    fireEvent.click(screen.getByRole("button", { name: "Tell me more" }));
    await waitFor(() => expect(client.chosen).toEqual([options[1]]));
  });

  it("no caption for a light interview", async () => {
    await renderIn("en", <Flow client={interviewClient("light")} />);
    await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByText(/uses .* of your AI plan/)).toBeNull();
  });

  it("Next closes the open interview first, then completes the step", async () => {
    const client = interviewClient();
    client.tasks = { current: { id: "t1", action: "conocerte", status: "waiting" }, actions: {}, notes: [] };
    await renderIn("en", <Flow client={client} />);
    await screen.findByRole("heading", { name: "Get to know you" });
    const next = await screen.findByRole("button", { name: "Next" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await screen.findByRole("heading", { name: "All set" });
    expect(client.taskCalls).toEqual(["finish"]);
    expect(client.setupCalls).toContain("complete:conocerte");
  });

  it("a closed interview with no valid record: says so, and offers to continue", async () => {
    const client = interviewClient();
    client.tasks = { current: null, actions: { conocerte: "unsaved" }, notes: [] };
    client.setupFailure = { ok: false, reason: "incomplete" };
    await renderIn("en", <Flow client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("The app doesn't have what it needs yet. Continue the interview to finish it.")).toBeTruthy();
    expect(client.taskCalls).toEqual([]);
    // The interview section is only in a task's first message: continuing starts a new task of the action.
    fireEvent.click(screen.getByRole("button", { name: "Continue the interview" }));
    await waitFor(() => expect(client.sentOptions).toEqual([{ action: "conocerte" }]));
  });
});
