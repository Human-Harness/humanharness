// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, PluginDetail, PluginReview, PluginRow } from "../src/client";
import { type SettingsTab, SettingsPage } from "../src/SettingsPage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

function Sheet({ client, initialTab = "plugins" }: { client: FakeClient; initialTab?: SettingsTab }) {
  const [state, setState] = useState<AppState>(client.state);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return <SettingsPage client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={() => {}} onSetup={() => {}} />;
}

const row = (over: Partial<PluginRow> = {}): PluginRow => ({ id: "oncall", name: "On-call", version: "1.2.0", origin: "local", folder: "~/my-plugins/oncall", status: "on", ...over });

const review = (over: Partial<PluginReview> = {}): PluginReview => ({
  id: "oncall",
  name: "On-call",
  version: "1.2.0",
  folder: "~/my-plugins/oncall",
  distHash: "hash-1",
  lines: [
    { kind: "hosts", hosts: ["*.atlassian.net", "api.firehydrant.io"] },
    { kind: "exec", command: "gh api", readOnly: true, wide: false },
    { kind: "secrets", labels: ["Jira token", "FireHydrant key"] },
    { kind: "tasks" },
  ],
  ...over,
});

const detail = (over: Partial<PluginDetail> = {}): PluginDetail => ({
  row: row(),
  review: review(),
  settings: {
    tab: "On-call",
    sections: [],
    fields: [{ name: "team", control: "text", label: "Team", default: "" }],
  },
  values: { team: "" },
  secrets: [
    { id: "jira", label: "Jira token", help: "From id.atlassian.com", stored: false },
    { id: "fh", label: "FireHydrant key", stored: true },
  ],
  sources: [{ id: "queues", ttl: 300, running: false }],
  errors: [
    { at: "2026-10-28T09:00:00.000Z", source: "queues", message: "older error" },
    { at: "2026-10-28T10:00:00.000Z", source: "queues", message: "newest error" },
  ],
  notify: false,
  ...over,
});

function client(plugins: PluginRow[] = [], local = true) {
  const c = new FakeClient(ready);
  c.state.plugins = { local };
  c.pluginsView = { local, plugins };
  return c;
}
async function draw(c: FakeClient, initialTab: SettingsTab = "plugins") {
  return renderIn("en", <Sheet client={c} initialTab={initialTab} />);
}

describe("Settings › Plugins", () => {
  it("D0: without state.plugins the tabs are today's and nothing is asked", async () => {
    const c = new FakeClient(ready);
    c.pluginsView = { local: true, plugins: [row()] };
    const rescan = vi.spyOn(c.plugins, "rescan");
    const get = vi.spyOn(c.plugins, "get");
    await draw(c, "general");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Usage"]);
    expect(rescan).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("adds Plugins after Sidekick, rescans once, and shows the empty state with Add from folder", async () => {
    const c = client();
    c.state.sidekick = { id: "sidekick", name: "Sidekick", mark: "spark" };
    await draw(c, "general");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Sidekick", "Plugins", "Usage"]);
    expect(c.pluginCalls).toEqual([]);
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(await screen.findByText("No plugins yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add from folder…" })).toBeTruthy();
    expect(c.pluginCalls).toEqual([["rescan"]]);
  });

  it("offers no Add button when the harness takes no local plugins", async () => {
    await draw(client([], false));
    await screen.findByText("No plugins yet.");
    expect(screen.queryByRole("button", { name: "Add from folder…" })).toBeNull();
  });

  it("lists each plugin with its origin, state, Updated tag, last sync and a switch", async () => {
    const c = client([
      row({ updated: true, lastSync: "2026-10-28T10:00:00.000Z" }),
      row({ id: "jira", name: "Jira", origin: "bundled", folder: undefined, status: "off" }),
      row({ id: "a", name: "A", status: "review" }),
      row({ id: "b", name: "B", status: "crashed" }),
      row({ id: "c", name: "C", status: "error", error: "dist is too large" }),
    ]);
    await draw(c);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toContain("1.2.0");
    expect(items[0].textContent).toContain("Local: ~/my-plugins/oncall");
    expect(items[0].textContent).toContain("On");
    expect(items[0].textContent).toContain("Updated");
    expect(items[0].textContent).toContain("Last sync");
    expect(items[1].textContent).toContain("Bundled");
    expect(items[1].textContent).toContain("Off");
    expect(items[2].textContent).toContain("Needs review");
    expect(items[3].textContent).toContain("Turned off after crashes");
    expect(items[4].textContent).toContain("Error: dist is too large");
    expect((screen.getByRole("switch", { name: "On-call" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Jira" }) as HTMLInputElement).checked).toBe(false);
  });

  it("turning on a plugin that needs a review opens the review; Turn on approves the reviewed dist", async () => {
    const c = client([row({ status: "review" })]);
    c.pluginResults = [{ ok: false, review: review({ distHash: "hash-2", added: [{ kind: "host", value: "evil.example.com" }] }) }, { ok: true }];
    await draw(c);
    fireEvent.click(await screen.findByRole("switch", { name: "On-call" }));
    const region = await screen.findByRole("region", { name: /On-call/ });
    expect(region.textContent).toContain("This version asks for more:");
    expect(region.textContent).toContain("evil.example.com");
    fireEvent.click(within(region).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(c.pluginCalls).toEqual([["rescan"], ["setOn", "oncall", true], ["approve", "oncall", "hash-2"]]));
    await waitFor(() => expect(screen.queryByRole("region", { name: /On-call/ })).toBeNull());
  });

  it("shows main's refusal when the plugin changed since the review", async () => {
    const c = client([row({ status: "review" })]);
    c.pluginResults = [{ ok: false, review: review() }, { ok: false, message: "This plugin changed; review it again" }];
    await draw(c);
    fireEvent.click(await screen.findByRole("switch", { name: "On-call" }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This plugin changed; review it again");
  });

  it("Add from folder: the review lists exactly what will be approved; Turn on adds the token then approves", async () => {
    const c = client();
    c.pluginPick = { ok: true, token: "tok-1", review: review() };
    c.pluginResults = [{ ok: true }, { ok: true }];
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    const region = await screen.findByRole("region", { name: /On-call/ });
    const lines = within(region)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lines).toEqual(["Connects to: *.atlassian.net, api.firehydrant.io", "Runs: gh api (read only)", "Stores 2 keys: Jira token, FireHydrant key", "Can propose agent tasks"]);
    expect(region.textContent).not.toContain("This version asks for more:");
    fireEvent.click(within(region).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(c.pluginCalls).toEqual([["rescan"], ["pick"], ["add", "tok-1"], ["approve", "oncall", "hash-1"]]));
  });

  it("says (any arguments) for a wide command and never says read only unless the line does", async () => {
    const c = client();
    c.pluginPick = {
      ok: true,
      token: "t",
      review: review({ lines: [{ kind: "exec", command: "curl", readOnly: false, wide: true }, { kind: "exec", command: "gh api --method POST x", readOnly: false, wide: false }] }),
    };
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    const region = await screen.findByRole("region", { name: /On-call/ });
    const lines = within(region)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lines).toEqual(["Runs: curl (any arguments)", "Runs: gh api --method POST x"]);
    expect(region.textContent).not.toContain("read only");
  });

  it("Cancel stores nothing; a refused pick shows its message; a cancelled pick shows nothing", async () => {
    const c = client();
    c.pluginPick = { ok: true, token: "t", review: review() };
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await screen.findByText("No plugins yet.");
    expect(c.pluginCalls).toEqual([["rescan"], ["pick"]]);

    c.pluginPick = { ok: false, message: "There is no plugin.json in this folder" };
    fireEvent.click(screen.getByRole("button", { name: "Add from folder…" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There is no plugin.json in this folder");

    c.pluginPick = { ok: false, cancelled: true };
    fireEvent.click(screen.getByRole("button", { name: "Add from folder…" }));
    await waitFor(() => expect(c.pluginCalls.filter((x) => x[0] === "pick")).toHaveLength(3));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  describe("detail", () => {
    async function openDetail(c: FakeClient) {
      await draw(c);
      fireEvent.click(await screen.findByRole("button", { name: "On-call" }));
      const region = await screen.findByRole("region", { name: /On-call/ });
      await within(region).findByRole("button", { name: "Test connection" });
      // The detail arrived outside act: let its effects run before typing (a draft input syncs to its value on mount).
      await act(async () => {});
      return region;
    }

    it("draws settings with SettingRow and shows a refusal under the field", async () => {
      const c = client([row()]);
      c.pluginDetails = { oncall: detail() };
      c.pluginResults = [{ ok: false, message: "Too long" }];
      const region = await openDetail(c);
      const input = within(region).getByRole("textbox", { name: "Team" });
      fireEvent.change(input, { target: { value: "payments" } });
      fireEvent.blur(input);
      await waitFor(() => expect(c.pluginCalls).toContainEqual(["setSetting", "oncall", "team", "payments"]));
      expect((await within(region).findByRole("alert")).textContent).toBe("Too long");
    });

    it("work hours show only with detail.workHours and save through setWorkHours", async () => {
      const c = client([row()]);
      c.pluginDetails = { oncall: detail() };
      const region = await openDetail(c);
      expect(within(region).queryByRole("group", { name: "Work hours" })).toBeNull();
      cleanup();

      const c2 = client([row()]);
      const wh = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", timezone: "Europe/Madrid" };
      c2.pluginDetails = { oncall: detail({ workHours: wh }) };
      c2.pluginResults = [{ ok: true }, { ok: true }];
      const r2 = await openDetail(c2);
      const group = within(r2).getByRole("group", { name: "Work hours" });
      const days = within(group).getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
      expect(days).toHaveLength(7);
      expect(days.filter((d) => d.getAttribute("aria-pressed") === "true")).toHaveLength(5);
      fireEvent.click(days[6]); // Saturday (Sunday first)
      await waitFor(() => expect(c2.pluginCalls).toContainEqual(["setWorkHours", "oncall", { ...wh, days: [1, 2, 3, 4, 5, 6] }]));
      fireEvent.change(within(group).getByLabelText("From"), { target: { value: "08:30" } });
      await waitFor(() => expect(c2.pluginCalls).toContainEqual(["setWorkHours", "oncall", { ...wh, from: "08:30" }]));
      expect((within(group).getByLabelText("Time zone") as HTMLSelectElement).value).toBe("Europe/Madrid");
    });

    it("B6: a saved key is sent to setSecret only, the input clears and the value is never in the DOM", async () => {
      const c = client([row()]);
      c.pluginDetails = { oncall: detail() };
      c.pluginResults = [{ ok: true }];
      const region = await openDetail(c);
      const keys = within(region).getByRole("group", { name: "Keys" });
      expect(keys.textContent).toContain("Jira token");
      expect(keys.textContent).toContain("From id.atlassian.com");
      expect(keys.textContent).toContain("Not stored");
      expect(keys.textContent).toContain("Stored");
      const input = keys.querySelector('input[type="password"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: "s3cret-value-XYZ" } });
      fireEvent.click(within(keys).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(c.pluginCalls).toContainEqual(["setSecret", "oncall", "jira", "s3cret-value-XYZ"]));
      expect(input.value).toBe("");
      expect(document.body.innerHTML).not.toContain("s3cret-value-XYZ");
      // A stored key offers Replace and Delete.
      c.pluginResults = [{ ok: true }];
      fireEvent.click(within(keys).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(c.pluginCalls).toContainEqual(["deleteSecret", "oncall", "fh"]));
      expect(within(keys).getByRole("button", { name: "Replace" })).toBeTruthy();
    });

    it("Test connection shows one line per source; last errors newest first; Notify me", async () => {
      const c = client([row()]);
      c.pluginDetails = { oncall: detail() };
      c.pluginTests = [
        { source: "queues", ok: true, writes: 12 },
        { source: "incidents", ok: false, error: "HTTP 401" },
      ];
      c.pluginResults = [{ ok: true }];
      const region = await openDetail(c);
      fireEvent.click(within(region).getByRole("button", { name: "Test connection" }));
      await waitFor(() => expect(region.textContent).toContain("queues: OK, 12 records"));
      expect(region.textContent).toContain("incidents: HTTP 401");
      const errors = within(region).getByRole("list", { name: "Last errors" });
      const msgs = within(errors)
        .getAllByRole("listitem")
        .map((li) => li.textContent);
      expect(msgs[0]).toContain("newest error");
      expect(msgs[1]).toContain("older error");
      fireEvent.click(within(region).getByRole("switch", { name: "Notify me" }));
      await waitFor(() => expect(c.pluginCalls).toContainEqual(["setNotify", "oncall", true]));
    });

    it("Remove (local only) confirms what goes, then removes", async () => {
      const c = client([row()]);
      c.pluginDetails = { oncall: detail() };
      c.pluginResults = [{ ok: true }];
      const region = await openDetail(c);
      fireEvent.click(within(region).getByRole("button", { name: "Remove…" }));
      expect(region.textContent).toContain("its settings, keys and data");
      expect(region.textContent).toContain("its folder stays");
      fireEvent.click(within(region).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(c.pluginCalls).toContainEqual(["remove", "oncall"]));
    });

    it("Remove moves focus to Add from folder", async () => {
      const c = client([row()]);
      c.pluginDetails = { oncall: detail() };
      c.pluginResults = [{ ok: true }];
      const region = await openDetail(c);
      fireEvent.click(within(region).getByRole("button", { name: "Remove…" }));
      fireEvent.click(within(region).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add from folder…" })));
    });

    it("a detail that fails to load or answers null says so instead of staying busy", async () => {
      const c = client([row()]);
      await draw(c);
      fireEvent.click(await screen.findByRole("button", { name: "On-call" }));
      const region = await screen.findByRole("region", { name: /On-call/ });
      expect((await within(region).findByRole("alert")).textContent).toBe("Something went wrong");
      expect(region.getAttribute("aria-busy")).toBe("false");
      cleanup();

      const c2 = client([row()]);
      vi.spyOn(c2.plugins, "detail").mockRejectedValue(new Error("ipc"));
      await draw(c2);
      fireEvent.click(await screen.findByRole("button", { name: "On-call" }));
      const r2 = await screen.findByRole("region", { name: /On-call/ });
      expect((await within(r2).findByRole("alert")).textContent).toBe("Something went wrong");
    });

    it("B12: markup in test results and error lines renders as text", async () => {
      const evil = "<img src=x onerror=alert(1)>";
      const c = client([row()]);
      c.pluginDetails = { oncall: detail({ errors: [{ at: "2026-10-28T10:00:00.000Z", source: evil, message: evil }] }) };
      c.pluginTests = [{ source: evil, ok: false, error: evil }];
      const region = await openDetail(c);
      fireEvent.click(within(region).getByRole("button", { name: "Test connection" }));
      await waitFor(() => expect(region.textContent).toContain(`${evil}: ${evil}`));
      const errors = within(region).getByRole("list", { name: "Last errors" });
      expect(errors.textContent).toContain(evil);
      expect(document.querySelector("img")).toBeNull();
    });

    it("is a list with the selected plugin's detail beside it", async () => {
      const c = client([row(), row({ id: "jira", name: "Jira", origin: "bundled", folder: undefined, status: "off" })]);
      c.pluginDetails = { oncall: detail() };
      const region = await openDetail(c);
      const both = document.querySelector(".hh-master-detail")!;
      expect(both.contains(region)).toBe(true);
      expect(within(both as HTMLElement).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
      expect(within(region).getByRole("heading", { name: "On-call" })).toBeTruthy();
      expect(screen.getByRole("switch", { name: "Jira" })).toBeTruthy();
    });

    it("a bundled plugin has no Remove", async () => {
      const c = client([row({ origin: "bundled", folder: undefined })]);
      c.pluginDetails = { oncall: detail({ row: row({ origin: "bundled", folder: undefined }) }) };
      const region = await openDetail(c);
      expect(within(region).queryByRole("button", { name: "Remove…" })).toBeNull();
    });
  });

  it("B12: plugin names and error text with markup render as text", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const c = client([row({ name: evil, status: "error", error: evil })]);
    await draw(c);
    await screen.findAllByRole("listitem");
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0);
    // Plugin text is isolated for bidi.
    const name = screen.getByRole("button", { name: evil });
    expect(name.getAttribute("dir") ?? name.querySelector("[dir]")?.getAttribute("dir")).toBe("auto");
  });

  it("an approve refused because the plugin changed replaces the stale review with main's current one", async () => {
    const c = client([row({ status: "review" })]);
    const current = review({ distHash: "hash-2", added: [{ kind: "host", value: "evil.example.com" }] });
    c.pluginResults = [{ ok: false, review: review() }, { ok: false, message: "This plugin changed; review it again", review: current }, { ok: true }];
    await draw(c);
    fireEvent.click(await screen.findByRole("switch", { name: "On-call" }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This plugin changed; review it again");
    const region = screen.getByRole("region", { name: /On-call/ });
    expect(region.textContent).toContain("evil.example.com");
    fireEvent.click(within(region).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(c.pluginCalls).toEqual([["rescan"], ["setOn", "oncall", true], ["approve", "oncall", "hash-1"], ["approve", "oncall", "hash-2"]]));
  });

  it("Cancel does nothing while Turn on is in flight; the plugin ends on and the review closes", async () => {
    const c = client();
    c.pluginPick = { ok: true, token: "tok-1", review: review() };
    c.pluginResults = [{ ok: true }];
    let resolve: (r: { ok: true }) => void = () => {};
    vi.spyOn(c.plugins, "approve").mockImplementation((id, hash) => {
      c.pluginCalls.push(["approve", id, hash]);
      return new Promise((r) => (resolve = r));
    });
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    const region = await screen.findByRole("region", { name: /On-call/ });
    fireEvent.click(within(region).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(c.pluginCalls).toContainEqual(["approve", "oncall", "hash-1"]));
    const cancel = within(region).getByRole("button", { name: "Cancel" });
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(cancel);
    expect(screen.getByRole("region", { name: /On-call/ })).toBeTruthy();
    await act(async () => resolve({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /On-call/ })).toBeNull());
  });

  it("add ok, approve refused, Turn on again: no second add, only approve", async () => {
    const c = client();
    c.pluginPick = { ok: true, token: "tok-1", review: review() };
    c.pluginResults = [{ ok: true }, { ok: false, message: "Something broke" }, { ok: true }];
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Something broke");
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(c.pluginCalls).toEqual([["rescan"], ["pick"], ["add", "tok-1"], ["approve", "oncall", "hash-1"], ["approve", "oncall", "hash-1"]]));
    await waitFor(() => expect(screen.queryByRole("region", { name: /On-call/ })).toBeNull());
  });

  it("focus goes back to Add from folder after a review Cancel, and to the row after a row's review turns it on", async () => {
    const c = client([row({ status: "review" })]);
    c.pluginPick = { ok: true, token: "t", review: review({ id: "new", name: "New" }) };
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add from folder…" })));

    c.pluginResults = [{ ok: false, review: review() }, { ok: true }];
    fireEvent.click(screen.getByRole("switch", { name: "On-call" }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "On-call" })));
  });

  it("a failed rescan says so instead of staying busy; so does a null answer", async () => {
    const c = client([row()]);
    vi.spyOn(c.plugins, "rescan").mockRejectedValue(new Error("ipc"));
    await draw(c);
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong");
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    cleanup();

    const c2 = client([row()]);
    vi.spyOn(c2.plugins, "rescan").mockResolvedValue(null as never);
    await draw(c2);
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong");
  });

  it("B12: markup in review hosts and key labels renders as text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const c = client();
    c.pluginPick = {
      ok: true,
      token: "t",
      review: review({ lines: [{ kind: "hosts", hosts: [evil] }, { kind: "secrets", labels: [evil] }], added: [{ kind: "secret", value: evil }] }),
    };
    await draw(c);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    const region = await screen.findByRole("region", { name: /On-call/ });
    expect(document.querySelector("img")).toBeNull();
    expect(region.textContent).toContain(`Connects to: ${evil}`);
    expect(region.textContent).toContain(evil);
    expect(within(region).getAllByText(evil).length).toBe(3);
  });

  it("follows main's pushes", async () => {
    const c = client([]);
    await draw(c);
    await screen.findByText("No plugins yet.");
    act(() => c.emitPlugins({ local: true, plugins: [row()] }));
    expect(await screen.findByRole("switch", { name: "On-call" })).toBeTruthy();
  });
});
