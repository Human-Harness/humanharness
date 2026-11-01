// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryTaskView, LimitWindow, TaskSummary } from "../src/client";
import { Home } from "../src/Home";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const fiveHour: LimitWindow = { kind: "five_hour", utilization: 0.18, resetsAt: new Date(Date.now() + 3600_000).toISOString() };

async function renderHome(client: FakeClient, { limits = null as LimitWindow[] | null, onEngine = () => {}, onOpen = undefined as ((i: unknown) => void) | undefined, checkFailed = false, onStart = () => {} } = {}) {
  await renderIn(
    "en",
    <Home
      state={client.state}
      client={client}
      onChange={() => {}}
      status={client.status}
      checkFailed={checkFailed}
      limits={limits}
      onStart={onStart}
      onSetup={() => {}}
      onSettings={() => {}}
      onEngine={onEngine}
      {...(onOpen ? { onOpen } : {})}
    />,
  );
}

describe("Home look (UI refresh spec §5.2)", () => {
  it("shows Pick up on a ready Home and hides it when setup is missing", async () => {
    await renderHome(new FakeClient(configured));
    expect(await screen.findByRole("heading", { name: "Pick up where you left" })).toBeTruthy();
    cleanup();
    await renderHome(new FakeClient({}));
    expect(screen.queryByRole("heading", { name: "Pick up where you left" })).toBeNull();
  });

  it("opens a history task in History through onOpen", async () => {
    const onOpen = vi.fn();
    await renderHome(new FakeClient(configured), { onOpen });
    await screen.findByRole("heading", { name: "Pick up where you left" });
    fireEvent.click(document.querySelector<HTMLButtonElement>(".hh-pickup-card")!);
    expect(onOpen).toHaveBeenCalledWith({ kind: "history", task: "t1" });
  });

  it("the engine pill says who is connected and the 5-hour use, and opens Settings › Engine", async () => {
    const onEngine = vi.fn();
    await renderHome(new FakeClient(configured), { limits: [fiveHour], onEngine });
    fireEvent.click(await screen.findByRole("button", { name: /Claude.*Connected.*5 h · 18%/ }));
    expect(onEngine).toHaveBeenCalled();
  });

  it("Start is the amber CTA", async () => {
    await renderHome(new FakeClient(configured));
    expect(screen.getByRole("button", { name: /Start Demo/ }).className).toContain("hh-start");
  });

  it("keeps the Home scrollable and the pill's name readable (review fixes)", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
    expect(css).toMatch(/\.hh-home \{[^}]*grid-template-rows: 64px minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.hh-home-main \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.hh-home-main \{[^}]*justify-content: safe center/);
  });

  it("does not ask History while setup is missing", async () => {
    const client = new FakeClient({});
    const spy = vi.spyOn(client, "historyTasks");
    await renderHome(client);
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Pick up where you left" })).toBeNull();
  });

  it("is hidden with an empty History, and when the engine is not connected", async () => {
    const empty = new FakeClient(configured);
    empty.historyGroups = [];
    await renderHome(empty);
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: "Pick up where you left" })).toBeNull();
    cleanup();
    await renderHome(new FakeClient(configured), { checkFailed: true });
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: "Pick up where you left" })).toBeNull();
  });

  it("history cards say Done and 'Note saved · …', skip job runs and outside-task groups", async () => {
    const client = new FakeClient(configured);
    const base = { actionId: null, start: "s", end: "e", changes: [], entries: [] };
    const date = new Date(Date.now() - 86_400_000).toISOString();
    const groups: HistoryTaskView[] = [
      { ...base, taskId: "n1", noteTitle: "The manifest", date },
      { ...base, taskId: "j1", jobId: "daily", date },
      { ...base, taskId: null, date },
    ];
    client.historyGroups = groups;
    await renderHome(client);
    await screen.findByRole("heading", { name: "Pick up where you left" });
    const cards = document.querySelectorAll(".hh-pickup-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("Done");
    expect(cards[0]!.textContent).toContain("The manifest");
    expect(cards[0]!.textContent).toContain("Note saved · yesterday");
  });

  describe("a harness with parallel", () => {
    const task = (over: Partial<TaskSummary>): TaskSummary => ({ id: "a", scope: "", action: null, label: "Engines", state: "waiting", startedAt: new Date().toISOString(), tokens: 0, ...over });
    const setup = () => {
      const client = new FakeClient(configured);
      client.state = { ...client.state, parallel: { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false }, actions: { topic: { label: "Topic", phases: [{ id: "p1", label: "Reading" }] } } } as never;
      client.tasks.set({ tasks: [task({ id: "a", action: "topic", phase: "p1" }), task({ id: "b", label: "Raw", phase: "unknown-id", state: "running" })], caps: { tasks: 2, jobs: 1 } });
      return client;
    };

    it("takes the open tasks, translates the status, shows the phase's label and never a raw id", async () => {
      const client = setup();
      const history = vi.spyOn(client, "historyTasks");
      await renderHome(client);
      await screen.findByRole("heading", { name: "Pick up where you left" });
      const text = [...document.querySelectorAll(".hh-pickup-card")].map((c) => c.textContent ?? "");
      expect(text[0]).toContain("Waiting for you");
      expect(text[0]).toContain("Reading");
      expect(text[1]).toContain("Working");
      expect(text[1]).not.toContain("unknown-id");
      expect(history).not.toHaveBeenCalled();
    });

    it("an open task opens through onOpen as open-task", async () => {
      const onOpen = vi.fn();
      await renderHome(setup(), { onOpen });
      await screen.findByRole("heading", { name: "Pick up where you left" });
      fireEvent.click(screen.getByRole("button", { name: /Engines/ }));
      expect(onOpen).toHaveBeenCalledWith({ kind: "open-task", task: "a" });
    });

    it("without onOpen it focuses the task, then goes to the work screen", async () => {
      const client = setup();
      const onStart = vi.fn();
      await renderHome(client, { onStart });
      await screen.findByRole("heading", { name: "Pick up where you left" });
      fireEvent.click(screen.getByRole("button", { name: /Engines/ }));
      expect(client.tasks.focus).toHaveBeenCalledWith("a");
      expect(onStart).toHaveBeenCalledOnce();
    });
  });
});
