// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { AppState, JobSummary } from "../src/client";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const at = "2026-10-28T09:00:00Z";
const jobsInfo = {
  jobs: [
    { id: "sync", label: "Sync inbox", manual: true },
    { id: "digest", label: "Digest", every: "1h", dailyTokens: 50_000, manual: false },
  ],
};
const rows = (): JobSummary[] => [
  { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Two conflicts need you", at, action: "implement" }, manual: true, running: false },
  { id: "digest", label: "Digest", scope: null, last: { status: "ok", summary: "Digest written", at }, manual: false, running: false },
];

function client(list: JobSummary[] = rows(), withJobs = true) {
  const c = new FakeClient(ready);
  if (withJobs) c.state.jobs = jobsInfo;
  c.state.actions = { intro: { label: "Intro", cost: "light" }, implement: { label: "Implement", cost: "light" } };
  c.jobsList = list;
  return c;
}

function Sheet({ c, tab: first = "jobs", onStartAction }: { c: FakeClient; tab?: SettingsTab; onStartAction?: (action: string, scope: string | null) => boolean }) {
  const [state, setState] = useState<AppState>(c.state);
  const [tab, setTab] = useState<SettingsTab>(first);
  return (
    <SettingsSheet
      client={c}
      state={state}
      tab={tab}
      onTab={setTab}
      onChange={setState}
      onClose={() => {}}
      onSetup={() => {}}
      {...(onStartAction ? { onStartAction } : {})}
    />
  );
}

/** The group of one job in the tab: its heading's section. */
const group = (label: string) => screen.getByRole("heading", { name: label }).closest("section")!;

describe("Settings › Jobs (parallel part 3 Task 10)", () => {
  it("D0: without state.jobs there is no Jobs tab and no jobs call", async () => {
    const c = client(rows(), false);
    const list = vi.spyOn(c.jobs, "list");
    await renderIn("en", <Sheet c={c} tab="general" />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).not.toContain("Jobs");
    expect(list).not.toHaveBeenCalled();
  });

  it("with jobs the tab sits before Usage and lists each declared job", async () => {
    const c = client();
    await renderIn("en", <Sheet c={c} />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.indexOf("Jobs")).toBeGreaterThan(-1);
    expect(tabs.indexOf("Jobs")).toBe(tabs.indexOf("Usage") - 1);
    expect(screen.getByRole("heading", { name: "Sync inbox" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Digest" })).toBeTruthy();
    expect(await within(group("Digest")).findByText("Digest written")).toBeTruthy();
  });

  it("On saves config.jobs[id].off and keeps the other jobs' settings", async () => {
    const c = client();
    c.state.config = { ...c.state.config, jobs: { digest: { dailyTokens: 20_000 } } };
    const save = vi.spyOn(c, "saveConfig");
    await renderIn("en", <Sheet c={c} />);
    const on = within(group("Sync inbox")).getByRole("checkbox", { name: "On" }) as HTMLInputElement;
    expect(on.checked).toBe(true);
    fireEvent.click(on);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ jobs: { digest: { dailyTokens: 20_000 }, sync: { off: true } } }));
    await waitFor(() => expect((within(group("Sync inbox")).getByRole("checkbox", { name: "On" }) as HTMLInputElement).checked).toBe(false));
    fireEvent.click(within(group("Sync inbox")).getByRole("checkbox", { name: "On" }));
    // Back on: its entry goes, as it holds nothing else.
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ jobs: { digest: { dailyTokens: 20_000 } } }));
  });

  it("an every job shows its interval and a Daily token cap that saves config.jobs[id].dailyTokens", async () => {
    const c = client();
    c.state.config = { ...c.state.config, jobs: { digest: { off: true } } };
    const save = vi.spyOn(c, "saveConfig");
    await renderIn("en", <Sheet c={c} />);
    const digest = group("Digest");
    expect(within(digest).getByText("Every 1h")).toBeTruthy();
    const cap = within(digest).getByLabelText("Daily token cap") as HTMLInputElement;
    // The manifest's until the person sets one.
    expect(cap.value).toBe("50000");
    expect(cap.min).toBe("1000");
    fireEvent.change(cap, { target: { value: "20000" } });
    fireEvent.blur(cap);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ jobs: { digest: { off: true, dailyTokens: 20_000 } } }));
    // A manual job has no cap.
    expect(within(group("Sync inbox")).queryByLabelText("Daily token cap")).toBeNull();
    expect(within(group("Sync inbox")).queryByText(/^Every/)).toBeNull();
  });

  it("a cap under 1,000 (or not a whole number) is not saved and the field says why", async () => {
    const c = client();
    const save = vi.spyOn(c, "saveConfig");
    await renderIn("en", <Sheet c={c} />);
    const cap = within(group("Digest")).getByLabelText("Daily token cap") as HTMLInputElement;
    fireEvent.change(cap, { target: { value: "500" } });
    fireEvent.keyDown(cap, { key: "Enter" });
    expect(await within(group("Digest")).findByRole("alert")).toHaveProperty("textContent", "The daily cap is at least 1,000 tokens.");
    expect(cap.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(cap, { target: { value: "1500.5" } });
    fireEvent.blur(cap);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(cap, { target: { value: "1000" } });
    fireEvent.blur(cap);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ jobs: { digest: { dailyTokens: 1000 } } }));
    await waitFor(() => expect(within(group("Digest")).queryByRole("alert")).toBeNull());
  });

  it("Run now only for manual jobs, with the row's scope; none while running or off", async () => {
    const c = client([
      { id: "sync", label: "Sync inbox", scope: "physics", manual: true, running: false },
      { id: "digest", label: "Digest", scope: null, manual: false, running: false },
    ]);
    await renderIn("en", <Sheet c={c} />);
    const run = await within(group("Sync inbox")).findByRole("button", { name: "Run now" });
    expect(within(group("Digest")).queryByRole("button", { name: "Run now" })).toBeNull();
    fireEvent.click(run);
    await waitFor(() => expect(c.jobs.run).toHaveBeenCalledWith("sync", "physics"));

    c.jobs.set([{ id: "sync", label: "Sync inbox", scope: "physics", manual: true, running: true }]);
    await waitFor(() => expect(within(group("Sync inbox")).queryByRole("button", { name: "Run now" })).toBeNull());
    c.jobs.set([{ id: "sync", label: "Sync inbox", scope: "physics", manual: true, running: false, paused: "off" }]);
    await within(group("Sync inbox")).findByText("Turned off");
    expect(within(group("Sync inbox")).queryByRole("button", { name: "Run now" })).toBeNull();
  });

  it("a Run now main refuses says so", async () => {
    const c = client([{ id: "sync", label: "Sync inbox", scope: null, manual: true, running: false }]);
    c.jobs.run.mockResolvedValueOnce(false);
    await renderIn("en", <Sheet c={c} />);
    fireEvent.click(await within(group("Sync inbox")).findByRole("button", { name: "Run now" }));
    expect(await within(group("Sync inbox")).findByRole("alert")).toHaveProperty("textContent", "Couldn't run it now.");
  });

  it("a needs-you run shows its status and summary, and Start names the declared action", async () => {
    const c = client();
    const start = vi.fn(() => true);
    await renderIn("en", <Sheet c={c} onStartAction={start} />);
    const sync = group("Sync inbox");
    expect(await within(sync).findByText("Needs you")).toBeTruthy();
    expect(within(sync).getByText("Two conflicts need you")).toBeTruthy();
    const button = within(sync).getByRole("button", { name: "Start" });
    // Described by the job's row, as the inbox's buttons are.
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(button);
    expect(start).toHaveBeenCalledWith("implement", null);
  });

  it("no Start for an action the harness doesn't declare, or without a start path", async () => {
    const c = client([{ id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Look", at, action: "toString" }, manual: false, running: false }]);
    await renderIn("en", <Sheet c={c} onStartAction={() => true} />);
    await within(group("Sync inbox")).findByText("Needs you");
    expect(within(group("Sync inbox")).queryByRole("button", { name: "Start" })).toBeNull();
    cleanup();
    await renderIn("en", <Sheet c={client()} />);
    await within(group("Sync inbox")).findByText("Needs you");
    expect(within(group("Sync inbox")).queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("a Start that can't go through says so", async () => {
    await renderIn("en", <Sheet c={client()} onStartAction={() => false} />);
    fireEvent.click(await within(group("Sync inbox")).findByRole("button", { name: "Start" }));
    expect(await within(group("Sync inbox")).findByRole("alert")).toHaveProperty("textContent", "Couldn't start it now.");
  });

  it("in the app (no inbox: jobs without parallel), Start from Settings starts the action in the chat and closes the sheet", async () => {
    const c = client([
      { id: "sync", label: "Sync inbox", scope: "physics", last: { status: "needs-you", summary: "Look", at, action: "implement" }, manual: false, running: false },
    ]);
    render(<HarnessApp client={c} />);
    const go = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Jobs" }));
    fireEvent.click(await within(group("Sync inbox")).findByRole("button", { name: "Start" }));
    await waitFor(() => expect(c.sentOptions.at(-1)).toEqual({ action: "implement", scope: "physics" }));
    expect(c.sent.at(-1)).toBe("Implement");
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });
});
