// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { AppState, JobSummary, ToolCallView } from "../src/client";
import { SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const at = "2026-10-28T09:00:00Z";
const jobsInfo = { jobs: [{ id: "sync", label: "Sync inbox", manual: true }, { id: "digest", label: "Digest", every: "1h", dailyTokens: 50_000, manual: false }] };
/** jobs-ui.test.tsx's rows (no `run`: a harness without tools). */
const plainRows = (): JobSummary[] => [
  { id: "sync", label: "Sync inbox", scope: null, last: { status: "needs-you", summary: "Two conflicts need you", at, action: "implement" }, manual: true, running: false },
  { id: "digest", label: "Digest", scope: null, last: { status: "ok", summary: "Digest written", at }, manual: false, running: false },
];
const withRun = (): JobSummary[] => [
  { id: "sync", label: "Sync inbox", scope: null, last: { status: "ok", summary: "3 steps · 1 AI step", at, run: "run-1" }, manual: true, running: false },
  { id: "digest", label: "Digest", scope: null, last: { status: "ok", summary: "Digest written", at }, manual: false, running: false },
];

const call = (over: Partial<ToolCallView> = {}): ToolCallView => ({
  tool: "list-prs",
  caller: "job",
  ok: true,
  ms: 300,
  summary: "4 pull requests",
  args: "{}",
  result: '[{"id":1}]',
  accesses: [{ kind: "fetch", target: "GET api.github.com/repos", allowed: true }],
  at,
  ...over,
});
const note = (text: string): ToolCallView => ({ tool: "step_output", caller: "job", ok: true, ms: 0, summary: "", args: "", accesses: [], note: text, at });

function client(list: JobSummary[]) {
  const c = new FakeClient(ready);
  c.state.parallel = { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false };
  c.tasksState = { tasks: [], caps: { tasks: 2, jobs: 1 } };
  c.state.jobs = jobsInfo;
  c.state.actions = { intro: { label: "Intro", cost: "light" }, implement: { label: "Implement", cost: "light" } };
  c.jobsList = list;
  return c;
}

/** The inbox's Jobs section, open. */
async function openInbox(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
  fireEvent.click(await screen.findByRole("button", { name: /^Inbox/ }));
  const section = screen.getByRole("heading", { name: "Jobs" }).closest("section")!;
  await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(2));
  return section as HTMLElement;
}

function Sheet({ c }: { c: FakeClient }) {
  const [state, setState] = useState<AppState>(c.state);
  return <SettingsSheet client={c} state={state} tab="jobs" onTab={() => {}} onChange={setState} onClose={() => {}} onSetup={() => {}} onStartAction={() => true} />;
}

describe("a job run's steps (tools spec §8.2)", () => {
  it("D0: a row without last.run renders as before", async () => {
    const c = client(plainRows());
    const trace = vi.spyOn(c.tools, "trace");
    const section = await openInbox(c);
    const items = within(section).getAllByRole("listitem");
    expect(within(section).queryByRole("button", { name: "Steps" })).toBeNull();
    expect(items[0].textContent).toContain("Two conflicts need you");
    expect(within(items[0]).getAllByRole("button").map((b) => b.textContent)).toEqual(["Start", "Run now"]);
    expect(within(items[1]).queryAllByRole("button")).toHaveLength(0);
    expect(trace).not.toHaveBeenCalled();
  });

  it("D0: Settings › Jobs without last.run has no Steps and reads no trace", async () => {
    const c = client(plainRows());
    const trace = vi.spyOn(c.tools, "trace");
    await renderIn("en", <Sheet c={c} />);
    await screen.findByText("Two conflicts need you");
    expect(screen.queryByRole("button", { name: "Steps" })).toBeNull();
    expect(trace).not.toHaveBeenCalled();
  });

  it("a row with last.run has a Steps button that unfolds the run's calls", async () => {
    const c = client(withRun());
    c.toolTraces["run-1"] = [call(), note("AI step: valid output · 1,234 tokens"), call({ tool: "post-comment", summary: "posted", ms: 1200 })];
    const trace = vi.spyOn(c.tools, "trace");
    const section = await openInbox(c);
    const items = within(section).getAllByRole("listitem");
    // Only the row with a run has it.
    expect(within(items[1]).queryByRole("button", { name: "Steps" })).toBeNull();
    const steps = within(items[0]).getByRole("button", { name: "Steps" });
    expect(steps.getAttribute("aria-expanded")).toBe("false");
    expect(trace).not.toHaveBeenCalled();
    fireEvent.click(steps);
    expect(steps.getAttribute("aria-expanded")).toBe("true");
    const first = await within(items[0]).findByRole("button", { name: "list-prs · 4 pull requests · 0.3 s · 0 tokens" });
    expect(trace).toHaveBeenCalledWith("run-1");
    // Folded, as slice 2's line.
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(within(items[0]).getByRole("button", { name: "post-comment · posted · 1.2 s · 0 tokens" })).toBeTruthy();
    expect(within(items[0]).getByText("AI step: valid output · 1,234 tokens")).toBeTruthy();
    // Folding and unfolding again reads it once.
    fireEvent.click(steps);
    expect(within(items[0]).queryByText("AI step: valid output · 1,234 tokens")).toBeNull();
    fireEvent.click(steps);
    await within(items[0]).findByText("AI step: valid output · 1,234 tokens");
    expect(trace).toHaveBeenCalledTimes(1);
  });

  it("an entry with an error shows unfolded", async () => {
    const c = client(withRun());
    c.toolTraces["run-1"] = [call({ ok: false, error: "GitHub answered 500", summary: "" })];
    const section = await openInbox(c);
    fireEvent.click(within(section).getByRole("button", { name: "Steps" }));
    const line = await within(section).findByRole("button", { name: "list-prs failed · GitHub answered 500" });
    expect(line.getAttribute("aria-expanded")).toBe("true");
  });

  it("a run with no entries says so", async () => {
    const c = client(withRun());
    const section = await openInbox(c);
    fireEvent.click(within(section).getByRole("button", { name: "Steps" }));
    expect(await within(section).findByText("No steps recorded for this run.")).toBeTruthy();
  });

  it("while the trace is read it says so", async () => {
    const c = client(withRun());
    vi.spyOn(c.tools, "trace").mockReturnValue(new Promise(() => {}));
    const section = await openInbox(c);
    fireEvent.click(within(section).getByRole("button", { name: "Steps" }));
    expect(within(section).getByText("Reading the steps…")).toBeTruthy();
  });

  it("a trace that can't be read says so and keeps the row", async () => {
    const c = client(withRun());
    vi.spyOn(c.tools, "trace").mockRejectedValue(new Error("/Users/me/secret/path broke"));
    const section = await openInbox(c);
    fireEvent.click(within(section).getByRole("button", { name: "Steps" }));
    expect(await within(section).findByText("Couldn't read this run's steps.")).toBeTruthy();
    const items = within(section).getAllByRole("listitem");
    expect(items[0].textContent).toContain("Sync inbox");
    expect(items[0].textContent).toContain("3 steps · 1 AI step");
    expect(items[0].textContent).not.toContain("secret");
    expect(within(items[0]).getByRole("button", { name: "Run now" })).toBeTruthy();
  });

  it("Settings › Jobs shows the same Steps under a run line", async () => {
    const c = client(withRun());
    c.toolTraces["run-1"] = [call(), note("AI step: valid output · 12 tokens")];
    const trace = vi.spyOn(c.tools, "trace");
    await renderIn("en", <Sheet c={c} />);
    await screen.findByText("3 steps · 1 AI step");
    const buttons = screen.getAllByRole("button", { name: "Steps" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole("button", { name: "list-prs · 4 pull requests · 0.3 s · 0 tokens" })).toBeTruthy();
    expect(screen.getByText("AI step: valid output · 12 tokens")).toBeTruthy();
    expect(trace).toHaveBeenCalledWith("run-1");
  });
});
