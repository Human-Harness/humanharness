// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, SetupStepView } from "../src/client";
import { type SettingsTab, SettingsPage } from "../src/SettingsPage";
import { SetupFlow } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const KEYS: SetupStepView = {
  id: "keys",
  kind: "connect",
  label: "Connect your tools",
  required: true,
  secrets: [
    { id: "jira", label: "Jira API token", help: "From id.atlassian.com › Security" },
    { id: "gh", label: "GitHub token" },
  ],
};
const EXTRA: SetupStepView = { id: "extra", kind: "connect", label: "Optional extras", required: false, secrets: [{ id: "slack", label: "Slack token" }] };

/** A configured app whose harness declares three keys and the given connect steps. */
function client(steps: SetupStepView[] = [KEYS]) {
  const c = new FakeClient(configured);
  c.state = { ...c.state, setup: steps, connections: { count: 3 } };
  c.connectionsDeclared = [
    { id: "jira", label: "Jira API token", help: "From id.atlassian.com › Security" },
    { id: "gh", label: "GitHub token" },
    { id: "slack", label: "Slack token" },
  ];
  return c;
}

function Flow({ c, startAt, onCancel = () => {} }: { c: FakeClient; startAt: string; onCancel?: () => void }) {
  const [state, setState] = useState<AppState>(c.state);
  return <SetupFlow client={c} state={state} onChange={setState} onCancel={onCancel} onStart={() => {}} startAt={startAt} />;
}

const next = () => within(screen.getByRole("contentinfo")).getByRole("button", { name: "Next" }) as HTMLButtonElement;
const row = (label: string) => screen.getByRole("group", { name: label });
const save = (label: string, value: string) => {
  fireEvent.change(within(row(label)).getByLabelText(label), { target: { value } });
  fireEvent.click(within(row(label)).getByRole("button", { name: "Save" }));
};

describe("the connect step (tools spec §9)", () => {
  it("shows each secret's label, help and field; Next is disabled until every one is set", async () => {
    const c = client();
    await renderIn("en", <Flow c={c} startAt="keys" />);
    expect(screen.getByRole("heading", { name: "Connect your tools" })).toBeTruthy();
    await screen.findByRole("group", { name: "Jira API token" });
    // Only the step's own keys, in the step's order; slack is declared but not listed here.
    expect(screen.getAllByRole("group").map((g) => g.querySelector(".hh-row-label")?.textContent)).toEqual([
      "Jira API token",
      "GitHub token",
    ]);
    expect(within(row("Jira API token")).getByText("From id.atlassian.com › Security")).toBeTruthy();
    expect((within(row("GitHub token")).getByLabelText("GitHub token") as HTMLInputElement).type).toBe("password");
    expect(within(row("Jira API token")).getByText("Not set · paste the key to use it")).toBeTruthy();
    expect(next().disabled).toBe(true);
    expect(screen.getByText("Paste each key to go on.")).toBeTruthy();

    save("Jira API token", "jira-secret-1234");
    await waitFor(() => expect(within(row("Jira API token")).getByText("Set")).toBeTruthy());
    expect(next().disabled).toBe(true);
    save("GitHub token", "ghp_secret_5678");
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(screen.queryByText("Paste each key to go on.")).toBeNull();
    // The saved field is gone from the flow's way: focus moves on to Next.
    expect(document.activeElement).toBe(next());
    expect(c.connectionsCalls).toEqual([
      ["set", "jira"],
      ["set", "gh"],
    ]);
    // A value never stays in the page.
    expect(document.body.innerHTML).not.toContain("jira-secret-1234");
    expect(document.body.innerHTML).not.toContain("ghp_secret_5678");
  });

  it("a refused key shows the reason, and Next stays disabled", async () => {
    const c = client();
    c.connectionsSet.add("jira");
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await screen.findByRole("group", { name: "GitHub token" });
    save("GitHub token", "short");
    expect((await screen.findByRole("alert")).textContent).toBe("A key is at least 8 characters");
    expect(next().disabled).toBe(true);
  });

  it("the same refusal twice is a new alert each time", async () => {
    const c = client();
    c.connectionsSet.add("jira");
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await screen.findByRole("group", { name: "GitHub token" });
    save("GitHub token", "short");
    const first = await screen.findByRole("alert");
    expect(first.textContent).toBe("A key is at least 8 characters");
    save("GitHub token", "short");
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(screen.getByRole("alert").textContent).toBe("A key is at least 8 characters");
    expect(first.isConnected).toBe(false);
    expect(next().disabled).toBe(true);
  });

  it("keys that can't be read say so, and Next stays disabled", async () => {
    const c = client();
    c.connectionsSet.add("jira").add("gh");
    c.connections.get = async () => null;
    await renderIn("en", <Flow c={c} startAt="keys" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Your keys can't be read right now.");
    expect(screen.queryByRole("group")).toBeNull();
    expect(next().disabled).toBe(true);
  });

  it("Next calls setupSteps.complete(id) and moves on", async () => {
    const c = client([KEYS, EXTRA]);
    c.connectionsSet.add("jira").add("gh");
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await waitFor(() => expect(next().disabled).toBe(false));
    // The next step's keys stay unknown until this test lets them through.
    const real = c.connections.get;
    let release = () => {};
    c.connections.get = () => new Promise((resolve) => (release = () => resolve(real())));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Optional extras" });
    expect(c.setupCalls).toContain("complete:keys");
    expect(c.setupState.steps.keys).toBe("done");
    // The next connect step starts from its own keys, not the last step's readiness: disabled before they are known.
    expect(next().disabled).toBe(true);
    expect(screen.queryByRole("group")).toBeNull();
    release();
    await screen.findByRole("group", { name: "Slack token" });
    expect(next().disabled).toBe(true);
  });

  it("a step that lists no key never enables Next", async () => {
    const c = client([{ ...EXTRA, secrets: [] }]);
    c.connectionsSet.add("jira").add("gh").add("slack");
    await renderIn("en", <Flow c={c} startAt="extra" />);
    // The keys are known (the caption shows only then) and the step still isn't ready.
    await screen.findByText("Paste each key to go on.");
    expect(screen.queryByRole("group")).toBeNull();
    expect(next().disabled).toBe(true);
  });

  it("a step that lists an undeclared key never enables Next", async () => {
    const c = client([{ ...KEYS, secrets: [{ id: "jira", label: "Jira API token" }, { id: "nope", label: "Not declared" }] }]);
    c.connectionsSet.add("jira").add("gh").add("slack");
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await screen.findByRole("group", { name: "Jira API token" });
    expect(within(row("Jira API token")).getByText("Set")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Not declared" })).toBeNull();
    expect(screen.getByText("Paste each key to go on.")).toBeTruthy();
    expect(next().disabled).toBe(true);
  });

  it("a refused Next says so and stays on the step", async () => {
    const c = client();
    c.connectionsSet.add("jira").add("gh");
    c.setupFailure = { ok: false, reason: "incomplete" };
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    // Worded for keys, not the interview's text.
    expect((await screen.findByRole("alert")).textContent).toBe("A key is missing. Paste it to go on.");
    expect(screen.getByRole("heading", { name: "Connect your tools" })).toBeTruthy();
  });

  it("Skip works for an optional step and is absent for a required one", async () => {
    const c = client([KEYS, EXTRA]);
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await screen.findByRole("group", { name: "Jira API token" });
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).queryByRole("button", { name: "Skip" })).toBeNull();
    cleanup();

    await renderIn("en", <Flow c={c} startAt="extra" />);
    await screen.findByRole("group", { name: "Slack token" });
    fireEvent.click(within(screen.getByRole("contentinfo")).getByRole("button", { name: "Skip" }));
    await screen.findByRole("heading", { name: "All set" });
    expect(c.setupCalls).toContain("skip:extra");
    expect(c.setupCalls).not.toContain("complete:extra");
  });

  it("a step whose keys are already set shows them as set and Next enabled", async () => {
    const c = client();
    c.connectionsSet.add("jira").add("gh");
    await renderIn("en", <Flow c={c} startAt="keys" />);
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(within(row("Jira API token")).getByText("Set")).toBeTruthy();
    expect(within(row("GitHub token")).getByText("Set")).toBeTruthy();
    expect(within(row("GitHub token")).getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(screen.queryByText("Paste each key to go on.")).toBeNull();
    // Nothing was saved here: focus stays on the step's heading.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Connect your tools" }));
  });

  it("Settings' list of setup steps shows a connect step with its state and an Open that goes to Connections", async () => {
    const c = client();
    c.setupState = { steps: { keys: "skipped" }, blocking: [] };
    const onSetup = vi.fn();
    function Sheet() {
      const [tab, setTab] = useState<SettingsTab>("harness");
      return <SettingsPage client={c} state={c.state} tab={tab} onTab={setTab} onChange={() => {}} onClose={() => {}} onSetup={onSetup} />;
    }
    await renderIn("en", <Sheet />);
    const item = screen.getByRole("listitem", { name: "Connect your tools" });
    await waitFor(() => expect(within(item).getByText("Skipped. You can do it now.")).toBeTruthy());
    expect(within(item).queryByRole("button", { name: "Do it now" })).toBeNull();
    fireEvent.click(within(item).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Connections" }).getAttribute("aria-selected")).toBe("true"));
    expect(await screen.findByRole("group", { name: "Slack token" })).toBeTruthy();
    expect(onSetup).not.toHaveBeenCalled();
  });
});

describe("the connect step in the setup frame (UI refresh spec §5.6)", () => {
  it("shows the folder and the engine as done steps with their values, and where this step is", async () => {
    await renderIn("en", <Flow c={client()} startAt="keys" />);
    await screen.findByRole("group", { name: "Jira API token" });
    const nav = screen.getByRole("list", { name: "Steps" });
    const items = within(nav).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, null, "step"]);
    expect(within(items[0]).getByText("/Users/me/Documents/Demo")).toBeTruthy();
    expect(within(items[1]).getByText("Claude")).toBeTruthy();
    expect(within(items[2]).getByText("Step 3 of 3")).toBeTruthy();
  });
});
