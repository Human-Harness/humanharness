// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { AppState, TaskView } from "../src/client";
import { FlowSide } from "../src/FlowSide";
import { StartView } from "../src/StartView";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const L = (en: string, es = en) => ({ es, en });
function state(): AppState {
  const s = new FakeClient().state;
  s.actions = {
    manifest: { label: L("The manifest", "El manifiesto"), description: L("What a harness declares."), cost: "medium" },
    engines: { label: L("Engines", "Motores"), cost: "medium" },
    turn: { label: L("A turn", "Un turno"), cost: "medium" },
  };
  s.path = ["manifest", "engines", "turn"];
  s.references = [{ id: "source", label: L("Source", "Código"), path: "~/code/humanharness" }];
  return s;
}
const idle = (actions: TaskView["actions"] = {}): TaskView => ({ current: null, actions, notes: [] });

describe("FlowSide", () => {
  it("marks done, current and pending steps, starts a step, and shows the read-only folder", async () => {
    const onStart = vi.fn();
    await renderIn("en", <FlowSide state={state()} lang="en" tasks={idle({ manifest: "done" })} disabled={false} onStart={onStart} onOpenNote={() => {}} />);
    const steps = screen.getByRole("list", { name: "Guided path" });
    expect(within(steps).getByRole("button", { name: /Engines/ }).getAttribute("aria-current")).toBe("step");
    expect(within(steps).getByRole("button", { name: /The manifest/ }).textContent).toContain("Done");
    expect(within(steps).getByRole("button", { name: /A turn/ }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(steps).getByRole("button", { name: /A turn/ }));
    expect(onStart).toHaveBeenCalledWith("turn");
    expect(screen.getByText("~/code/humanharness")).toBeTruthy();
    expect(screen.getByText("Read only: the AI doesn't change anything here")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "What's clear so far" })).toBeNull();
  });

  it("marks the running task's step without restarting it, and lists the notes", async () => {
    const onOpenNote = vi.fn();
    const tasks: TaskView = {
      current: { id: "t1", action: "turn", status: "waiting" },
      actions: {},
      notes: [{ slug: "manifest", title: "El manifiesto", action: "manifest", date: "", summary: ["a"], decisions: [], path: ".harness/notes/manifest.md" }],
    };
    await renderIn("es", <FlowSide state={state()} lang="es" tasks={tasks} disabled={false} onStart={() => {}} onOpenNote={onOpenNote} />);
    const turn = within(screen.getByRole("list", { name: "Recorrido" })).getByRole("button", { name: /Un turno/ });
    expect(turn.getAttribute("aria-current")).toBe("step");
    expect((turn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("list", { name: "Lo que ya quedó claro" })).getByRole("button", { name: "El manifiesto" }));
    expect(onOpenNote).toHaveBeenCalledWith("manifest");
  });

  it("shows the running task's context in use against its cap, with the exact tokens on hover", async () => {
    const tasks: TaskView = { current: { id: "t1", action: "engines", status: "waiting", context: { used: 170_000, cap: 200_000 } }, actions: {}, notes: [] };
    await renderIn("en", <FlowSide state={state()} lang="en" tasks={tasks} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    const meter = screen.getByRole("meter", { name: "Context in use" });
    expect(meter.getAttribute("aria-valuenow")).toBe("85");
    expect(meter.getAttribute("title")).toBe("170,000 of 200,000 tokens");
    expect(meter.className).toContain("warn");
    expect(screen.getAllByRole("meter")).toHaveLength(1);
  });

  it("shows a free question's meter on its own row, and none before the engine reports any", async () => {
    const question: TaskView = { current: { id: "t2", status: "waiting", context: { used: 20_000, cap: 100_000 } }, actions: {}, notes: [] };
    const { unmount } = await renderIn("en", <FlowSide state={state()} lang="en" tasks={question} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    expect(screen.getByText("Free question")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Context in use" }).getAttribute("aria-valuenow")).toBe("20");
    unmount();
    await renderIn("en", <FlowSide state={state()} lang="en" tasks={{ ...question, current: { id: "t2", status: "waiting" } }} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    expect(screen.queryByRole("meter")).toBeNull();
  });
});

describe("StartView", () => {
  it("shows the topics in path order with their badges, then the rest, and starts them", async () => {
    const onStart = vi.fn();
    const s = state();
    s.actions.extra = { label: L("Extra"), description: L("Not on the path"), cost: "light" };
    await renderIn(
      "en",
      <StartView state={s} lang="en" tasks={idle({ manifest: "done", turn: "unsaved" })} notice={null} disabled={false} onStart={onStart} onAsk={() => {}} />,
    );
    const topics = within(screen.getByRole("region", { name: "Where do we start?" })).getAllByRole("button");
    expect(topics.map((b) => b.querySelector(".hh-topic-title")?.textContent)).toEqual(["The manifest", "Engines", "A turn", "Extra"]);
    expect(topics[0].textContent).toContain("Done");
    expect(topics[1].textContent).toContain("Next on the path");
    expect(topics[1].className).toContain("next");
    expect(topics[2].textContent).toContain("No summary");
    expect(topics[0].textContent).toContain("What a harness declares.");
    fireEvent.click(topics[3]);
    expect(onStart).toHaveBeenCalledWith("extra");
    expect(screen.getByText("Pick a topic, or ask a question below.")).toBeTruthy();
  });

  it("uses the harness's copy, asks its frequent questions and shows a notice", async () => {
    const onAsk = vi.fn();
    const i18n = await createI18n("en", { en: { title: "Which part?", intro: "Pick one.", faq: { own: "How do I build my own?" } } });
    render(
      <I18nextProvider i18n={i18n}>
        <StartView
          state={state()}
          lang="en"
          tasks={idle()}
          copy={{ title: "title", intro: "intro", faq: ["faq.own"] }}
          notice="You're now using Codex."
          disabled={false}
          onStart={() => {}}
          onAsk={onAsk}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("region", { name: "Which part?" })).toBeTruthy();
    expect(screen.getByText("Pick one.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("You're now using Codex.");
    fireEvent.click(screen.getByRole("button", { name: "How do I build my own?" }));
    expect(onAsk).toHaveBeenCalledWith("How do I build my own?");
  });
});
