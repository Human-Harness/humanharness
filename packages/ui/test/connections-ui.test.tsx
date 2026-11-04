// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, ConnectionsView, SetupStepView } from "../src/client";
import { ConnectStep } from "../src/connections/ConnectStep";
import { type SettingsTab, SettingsPage } from "../src/SettingsPage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

/** A harness with two keys: jira (set) and gh (not set). Without `withSecrets`, a harness that declares none. */
function client(withSecrets = true) {
  const c = new FakeClient(ready);
  if (withSecrets) {
    c.state.connections = { count: 2 };
    c.connectionsDeclared = [
      { id: "jira", label: "Jira API token", help: "From id.atlassian.com › Security" },
      { id: "gh", label: "GitHub token" },
    ];
    c.connectionsSet.add("jira");
  }
  return c;
}

function Sheet({ c, tab: first = "connections" }: { c: FakeClient; tab?: SettingsTab }) {
  const [state, setState] = useState<AppState>(c.state);
  const [tab, setTab] = useState<SettingsTab>(first);
  return <SettingsPage client={c} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={() => {}} onSetup={() => {}} />;
}

/** One declared key's row, by its label. */
const row = (label: string) => screen.getByRole("group", { name: label });
const field = (label: string) => within(row(label)).getByLabelText(label) as HTMLInputElement;
/** A row's More (⋯) button, or null when the row has nothing to put in it. */
const moreButton = (label: string) => within(row(label)).queryByRole("button", { name: `More for ${label}` });
/** Opens a row's More (⋯) menu: Radix opens it on a primary pointer down. */
async function openMore(label: string) {
  fireEvent.pointerDown(moreButton(label)!, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.findByRole("menu");
}
/** One item of a row's More menu, or null; the menu stays open. */
const menuItem = async (label: string, name: string) => within(await openMore(label)).queryByRole("menuitem", { name });
const closeMenu = () => fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
/** Delete is in More and asks inline under its row first; the second click deletes (DESIGN.md "Secret"). */
async function deleteKey(label: string) {
  fireEvent.click((await menuItem(label, "Delete"))!);
  fireEvent.click(await within(row(label)).findByRole("button", { name: "Delete the key" }));
}

describe("Settings › Connections (tools spec §9)", () => {
  it("D0: no Connections tab without state.connections", async () => {
    const c = client(false);
    const get = vi.spyOn(c.connections, "get");
    await renderIn("en", <Sheet c={c} tab="general" />, { theme: true });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).not.toContain("Connections");
    expect(get).not.toHaveBeenCalled();
  });

  it("the tab sits right after Plugins when there is one, and before Jobs and Usage", async () => {
    const c = client();
    c.state.plugins = { local: false };
    c.state.jobs = { jobs: [] };
    await renderIn("en", <Sheet c={c} tab="general" />, { theme: true });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.indexOf("Connections")).toBe(tabs.indexOf("Plugins") + 1);
    expect(tabs.indexOf("Connections")).toBe(tabs.indexOf("Jobs") - 1);
  });

  it("lists each declared secret with its help and state", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    const jira = await screen.findByRole("group", { name: "Jira API token" });
    expect(within(jira).getByText("Set")).toBeTruthy();
    expect(within(jira).getByText("From id.atlassian.com › Security")).toBeTruthy();
    expect(within(jira).getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(await menuItem("Jira API token", "Delete")).toBeTruthy();
    closeMenu();
    const gh = row("GitHub token");
    expect(within(gh).getByText("Not set · paste the key to use it")).toBeTruthy();
    expect(within(gh).getByRole("button", { name: "Save" })).toBeTruthy();
    // Not set and no test: nothing for More to hold.
    expect(moreButton("GitHub token")).toBeNull();
    // Manifest order.
    expect(jira.compareDocumentPosition(gh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/stored encrypted on this computer/)).toBeTruthy();
  });

  it("Save sends the value once and clears the field before the answer", async () => {
    const c = client();
    let release!: () => void;
    const real = c.connections.set;
    const set = vi.spyOn(c.connections, "set").mockImplementation(async (id, value) => {
      await new Promise<void>((resolve) => (release = resolve));
      return real(id, value);
    });
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    fireEvent.change(field("GitHub token"), { target: { value: "tok-123456789" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("gh", "tok-123456789");
    // Pending: the field is already empty.
    expect(field("GitHub token").value).toBe("");
    await act(async () => release());
    await waitFor(() => expect(within(row("GitHub token")).getByText("Set")).toBeTruthy());
    expect(within(row("GitHub token")).getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(await menuItem("GitHub token", "Delete")).toBeTruthy();
    closeMenu();
    expect(set).toHaveBeenCalledTimes(1);
    expect(c.connectionsCalls).toEqual([["set", "gh"]]);
  });

  it("an empty field sends nothing", async () => {
    const c = client();
    const set = vi.spyOn(c.connections, "set");
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    const save = within(row("GitHub token")).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field("GitHub token"), { target: { value: "   " } });
    expect(save.disabled).toBe(true);
    // Enter in the field submits the form even with Save disabled: still nothing is sent.
    fireEvent.submit(field("GitHub token").form!);
    expect(set).not.toHaveBeenCalled();
    expect(field("GitHub token").value).toBe("");
    fireEvent.change(field("GitHub token"), { target: { value: "tok-123456789" } });
    expect(save.disabled).toBe(false);
  });

  it("after Delete, focus stays in the row (on its field), not on the page", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    await deleteKey("Jira API token");
    await waitFor(() => expect(within(row("Jira API token")).getByText("Not set · paste the key to use it")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(field("Jira API token")));
    expect(row("Jira API token").contains(document.activeElement)).toBe(true);
  });

  it("an unset key shows a password field and Save", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    const gh = await screen.findByRole("group", { name: "GitHub token" });
    expect(field("GitHub token").type).toBe("password");
    // Save is the primary (solid amber); Replace on a set key is the secondary (outline gray).
    expect(within(gh).getByRole("button", { name: "Save" }).className).toContain("rt-variant-solid");
    expect(within(row("Jira API token")).getByRole("button", { name: "Replace" }).className).toContain("rt-variant-outline");
    expect(within(gh).getByText("Not set · paste the key to use it").getAttribute("data-accent-color")).toBe("orange");
    expect(within(row("Jira API token")).getByText("Set").getAttribute("data-accent-color")).toBe("green");
  });

  it("the field is described by the key's state and its help", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    const describedBy = (label: string) =>
      field(label)
        .getAttribute("aria-describedby")!
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
    expect(describedBy("Jira API token")).toEqual(["Set", "From id.atlassian.com › Security"]);
    expect(describedBy("GitHub token")).toEqual(["Not set · paste the key to use it"]);
  });

  it("Delete asks inline under its row, and Cancel keeps the key", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    fireEvent.click((await menuItem("Jira API token", "Delete"))!);
    const jira = row("Jira API token");
    expect(within(jira).getByText("Delete the key for Jira API token? The app can't use it until you paste it again.")).toBeTruthy();
    expect(c.connectionsCalls).toEqual([]);
    fireEvent.click(within(jira).getByRole("button", { name: "Cancel" }));
    expect(within(jira).queryByRole("button", { name: "Delete the key" })).toBeNull();
    expect(within(jira).getByText("Set")).toBeTruthy();
    expect(c.connectionsCalls).toEqual([]);
  });

  it("the same refusal twice is a new alert each time", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    fireEvent.change(field("GitHub token"), { target: { value: "short" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    const first = await screen.findByRole("alert");
    expect(first.textContent).toBe("A key is at least 8 characters");
    fireEvent.change(field("GitHub token"), { target: { value: "short" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(screen.getByRole("alert").textContent).toBe("A key is at least 8 characters");
    expect(first.isConnected).toBe(false);
  });

  it("a refusal shows its message; Delete makes the row Not set", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    fireEvent.change(field("GitHub token"), { target: { value: "short" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent?.trim()).toBe("A key is at least 8 characters");
    expect(within(row("GitHub token")).getByText("Not set · paste the key to use it")).toBeTruthy();
    expect(field("GitHub token").value).toBe("");

    await deleteKey("Jira API token");
    await waitFor(() => expect(within(row("Jira API token")).getByText("Not set · paste the key to use it")).toBeTruthy());
    expect(c.connectionsCalls).toEqual([
      ["set", "gh"],
      ["delete", "jira"],
    ]);
    expect(moreButton("Jira API token")).toBeNull();
    // The answer that worked clears the old refusal.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a set that throws says it didn't save", async () => {
    const c = client();
    vi.spyOn(c.connections, "set").mockRejectedValue(new Error("ipc gone"));
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    fireEvent.change(field("GitHub token"), { target: { value: "tok-123456789" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent?.trim()).toBe("That didn't save.");
  });

  it("a view main can't give says so, with no rows", async () => {
    const c = client();
    vi.spyOn(c.connections, "get").mockResolvedValue(null);
    await renderIn("en", <Sheet c={c} />, { theme: true });
    expect((await screen.findByRole("alert")).textContent?.trim()).toBe("Your keys can't be read right now.");
    expect(screen.queryByRole("group", { name: "GitHub token" })).toBeNull();
  });

  it("never renders a value: the input is type=password and empty after save", async () => {
    const c = client();
    const { container } = await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    const input = field("GitHub token");
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    fireEvent.change(input, { target: { value: "tok-secret-987654321" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(row("GitHub token")).getByText("Set")).toBeTruthy());
    expect(field("GitHub token").value).toBe("");
    expect(container.innerHTML).not.toContain("tok-secret-987654321");
    for (const el of Array.from(container.querySelectorAll("input"))) expect(el.value).toBe("");
  });

  it("a stale push never wins: the tab asks again and shows the current state", async () => {
    const c = client();
    let push!: (view: ConnectionsView) => void;
    const onChange = c.connections.onChange;
    vi.spyOn(c.connections, "onChange").mockImplementation((l) => {
      push = l;
      return onChange(l);
    });
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    fireEvent.change(field("GitHub token"), { target: { value: "tok-123456789" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(row("GitHub token")).getByText("Set")).toBeTruthy());
    // An older push (from before the set) arrives last: gh not set.
    const get = vi.spyOn(c.connections, "get");
    await act(async () =>
      push({
        connections: [
          { id: "jira", label: "Jira API token", set: true },
          { id: "gh", label: "GitHub token", set: false },
        ],
      }),
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(within(row("GitHub token")).getByText("Set")).toBeTruthy());
  });

  it("the last of overlapping answers wins, not the slowest", async () => {
    const c = client();
    const answers: ((v: ConnectionsView) => void)[] = [];
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "GitHub token" });
    // From now on every get waits; the first asked comes back last, with an old view.
    vi.spyOn(c.connections, "get").mockImplementation(() => new Promise<ConnectionsView>((resolve) => answers.push(resolve)));
    await deleteKey("Jira API token");
    await waitFor(() => expect(answers.length).toBeGreaterThan(0));
    fireEvent.change(field("GitHub token"), { target: { value: "tok-123456789" } });
    fireEvent.click(within(row("GitHub token")).getByRole("button", { name: "Save" }));
    const before = answers.length;
    await waitFor(() => expect(answers.length).toBeGreaterThan(before));
    await act(async () => {});
    const now: ConnectionsView = {
      connections: [
        { id: "jira", label: "Jira API token", set: false },
        { id: "gh", label: "GitHub token", set: true },
      ],
    };
    const old: ConnectionsView = {
      connections: [
        { id: "jira", label: "Jira API token", set: false },
        { id: "gh", label: "GitHub token", set: false },
      ],
    };
    await act(async () => answers.at(-1)!(now));
    await act(async () => answers.slice(0, -1).forEach((answer) => answer(old)));
    expect(within(row("GitHub token")).getByText("Set")).toBeTruthy();
  });
});

describe("Test connection (tools spec §9, slice 2)", () => {
  /** Test connection, from the row's More menu (null when the row has no menu or no test). */
  const test = async (label: string) => (moreButton(label) ? menuItem(label, "Test connection") : null);
  const runTest = async (label: string) => fireEvent.click((await test(label))!);

  it("no Test button when no connect step names a test for that secret", async () => {
    const c = client();
    c.connectionsTests = { jira: { ok: true } };
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    expect(await test("Jira API token")).toBeTruthy();
    closeMenu();
    expect(await test("GitHub token")).toBeNull();
    // D0: no test anywhere, no item anywhere.
    cleanup();
    await renderIn("en", <Sheet c={client()} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    expect(await test("Jira API token")).toBeNull();
    closeMenu();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Test shows Works or the error under the row", async () => {
    const c = client();
    c.connectionsTests = { jira: { ok: true } };
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    await runTest("Jira API token");
    expect((await within(row("Jira API token")).findByRole("status")).textContent).toBe("Works");
    expect(c.connectionsCalls).toEqual([["test", "jira"]]);

    c.connectionsTests = { jira: { ok: false, message: "Jira answered 401 Unauthorized" } };
    await runTest("Jira API token");
    await waitFor(() => expect(within(row("Jira API token")).getByRole("status").textContent).toBe("Didn't work: Jira answered 401 Unauthorized"));
    // Under its own row only; the sheet's alert is for refused saves.
    expect(within(row("GitHub token")).queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the last test shows before any click, and goes once the key is replaced", async () => {
    const c = client();
    c.connectionsTests = { jira: { ok: true } };
    c.connectionsLastTest = { jira: { at: "2026-10-29T10:00:00.000Z", ok: false, message: "Jira answered 401" } };
    await renderIn("en", <Sheet c={c} />, { theme: true });
    expect((await within(await screen.findByRole("group", { name: "Jira API token" })).findByRole("status")).textContent).toBe("Didn't work: Jira answered 401");
    fireEvent.change(field("Jira API token"), { target: { value: "tok-123456789" } });
    fireEvent.click(within(row("Jira API token")).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(within(row("Jira API token")).queryByRole("status")).toBeNull());
  });

  it("Test is disabled while it runs, and a test that throws says it couldn't run", async () => {
    const c = client();
    c.connectionsTests = { jira: { ok: true } };
    let fail!: (e: Error) => void;
    vi.spyOn(c.connections, "test").mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    await renderIn("en", <Sheet c={c} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    await runTest("Jira API token");
    expect(within(row("Jira API token")).getByRole("status").textContent).toBe("Testing…");
    expect((await test("Jira API token"))!.hasAttribute("data-disabled")).toBe(true);
    closeMenu();
    await act(async () => fail(new Error("ipc gone /Users/me")));
    await waitFor(() => expect(within(row("Jira API token")).getByRole("status").textContent).toBe("Didn't work: The test couldn't run."));
    expect((await test("Jira API token"))!.hasAttribute("data-disabled")).toBe(false);
  });

  it("under StrictMode (mount, unmount, mount) the answer still shows", async () => {
    const c = client();
    c.connectionsTests = { jira: { ok: false, message: "Jira answered 401" } };
    await renderIn(
      "en",
      <StrictMode>
        <Sheet c={c} />
      </StrictMode>,
      { theme: true },
    );
    await screen.findByRole("group", { name: "Jira API token" });
    // A test that changes nothing main keeps, so only this click's answer can show it.
    vi.spyOn(c.connections, "test").mockResolvedValue({ ok: false, message: "This key has no test" });
    await runTest("Jira API token");
    expect((await within(row("Jira API token")).findByRole("status")).textContent).toBe("Didn't work: This key has no test");
  });

  it("the connect step offers Test for its keys that have one", async () => {
    const c = client();
    c.connectionsTests = { jira: { ok: true } };
    const step: SetupStepView = { id: "keys", kind: "connect", label: "Connect", required: false, secrets: [{ id: "jira", label: "Jira API token" }, { id: "gh", label: "GitHub token" }] };
    await renderIn("en", <ConnectStep client={c} step={step} onReady={() => {}} />, { theme: true });
    await screen.findByRole("group", { name: "Jira API token" });
    expect(moreButton("GitHub token")).toBeNull();
    await runTest("Jira API token");
    expect((await within(row("Jira API token")).findByRole("status")).textContent).toBe("Works");
  });
});
