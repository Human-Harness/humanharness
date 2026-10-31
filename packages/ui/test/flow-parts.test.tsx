// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { AppState, TaskView } from "../src/client";
import { ContextMeter, FlowSide } from "../src/FlowSide";
import { StartView } from "../src/StartView";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function state(): AppState {
  const s = new FakeClient().state;
  s.actions = {
    manifest: { label: "The manifest", description: "What a harness declares.", cost: "medium" },
    engines: { label: "Engines", cost: "medium" },
    turn: { label: "A turn", cost: "medium" },
  };
  s.path = ["manifest", "engines", "turn"];
  s.references = [{ id: "source", label: "Source", path: "~/code/humanharness" }];
  return s;
}
const idle = (actions: TaskView["actions"] = {}): TaskView => ({ current: null, actions, notes: [] });

describe("FlowSide", () => {
  it("marks done, current and pending steps, starts a step, and shows the read-only folder", async () => {
    const onStart = vi.fn();
    await renderIn("en", <FlowSide state={state()} tasks={idle({ manifest: "done" })} disabled={false} onStart={onStart} onOpenNote={() => {}} />);
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
    await renderIn("en", <FlowSide state={state()} tasks={tasks} disabled={false} onStart={() => {}} onOpenNote={onOpenNote} />);
    const turn = within(screen.getByRole("list", { name: "Guided path" })).getByRole("button", { name: /A turn/ });
    expect(turn.getAttribute("aria-current")).toBe("step");
    expect((turn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("list", { name: "What's clear so far" })).getByRole("button", { name: "El manifiesto" }));
    expect(onOpenNote).toHaveBeenCalledWith("manifest");
  });

  it("shows the running task's context in use against its cap, with the exact tokens on hover", async () => {
    const tasks: TaskView = { current: { id: "t1", action: "engines", status: "waiting", context: { used: 170_000, cap: 200_000 } }, actions: {}, notes: [] };
    await renderIn("en", <FlowSide state={state()} tasks={tasks} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    const meter = screen.getByRole("meter", { name: "Context in use" });
    expect(meter.getAttribute("aria-valuenow")).toBe("85");
    expect(meter.getAttribute("title")).toBe("170,000 of 200,000 tokens");
    expect(meter.className).toContain("warn");
    expect(screen.getAllByRole("meter")).toHaveLength(1);
  });

  it("shows a free question's meter on its own row, and none before the engine reports any", async () => {
    const question: TaskView = { current: { id: "t2", status: "waiting", context: { used: 20_000, cap: 100_000 } }, actions: {}, notes: [] };
    const { unmount } = await renderIn("en", <FlowSide state={state()} tasks={question} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    expect(screen.getByText("Free question")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Context in use" }).getAttribute("aria-valuenow")).toBe("20");
    unmount();
    await renderIn("en", <FlowSide state={state()} tasks={{ ...question, current: { id: "t2", status: "waiting" } }} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    expect(screen.queryByRole("meter")).toBeNull();
  });
});

describe("FlowSide in the soft-cards look (UI refresh spec §5.1)", () => {
  it("marks done steps with a green Done tag and the current one with an orange Now tag, and counts them", async () => {
    const s = state();
    s.actions.blocks = { label: "Blocks", cost: "medium" };
    s.path = ["manifest", "engines", "turn", "blocks"];
    const tasks: TaskView = { current: { id: "t1", action: "turn", status: "waiting" }, actions: { manifest: "done", engines: "done" }, notes: [] };
    await renderIn("en", <FlowSide state={s} tasks={tasks} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    const steps = screen.getByRole("list", { name: "Guided path" });
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(within(within(steps).getByRole("button", { name: /A turn/ })).getByText("Now").className).toContain("hh-tag-orange");
    expect(within(within(steps).getByRole("button", { name: /Engines/ })).getByText("Done").className).toContain("hh-tag-green");
    expect(within(within(steps).getByRole("button", { name: /Blocks/ })).queryByText(/Now|Done/)).toBeNull();
    // aria-current says "Now" to screen readers: the current step keeps its plain name.
    expect(within(steps).getByRole("button", { name: "A turn" }).getAttribute("aria-current")).toBe("step");
  });

  it("idle, the step the path suggests is Up next, not Now: nothing is under way", async () => {
    await renderIn("en", <FlowSide state={state()} tasks={idle({ manifest: "done" })} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    const engines = within(screen.getByRole("list", { name: "Guided path" })).getByRole("button", { name: "Engines" });
    expect(engines.getAttribute("aria-current")).toBe("step");
    expect(within(engines).getByText("Up next").className).toContain("hh-tag-orange");
    expect(within(engines).queryByText("Now")).toBeNull();
    // A free question runs: still nothing on the path is under way.
    cleanup();
    await renderIn("en", <FlowSide state={state()} tasks={{ ...idle({ manifest: "done" }), current: { id: "q", status: "waiting" } }} disabled={false} onStart={() => {}} onOpenNote={() => {}} />);
    expect(screen.queryByText("Now")).toBeNull();
  });
});

describe("ContextMeter as a text pill (UI refresh spec §5.1, flow mode)", () => {
  it("without its ring it is still the panel's button with the readout, and adds no second meter", async () => {
    await renderIn("en", <ContextMeter used={84_000} cap={200_000} onOpen={() => {}} pill ring={false} />);
    const pill = screen.getByRole("button", { name: "What the AI takes into account", description: "Context in use: 42%, 84,000 of 200,000 tokens" });
    expect(pill.textContent).toContain("Context 42%");
    expect(screen.queryByRole("meter")).toBeNull();
  });
});

describe("ContextMeter", () => {
  it("renders nothing without a cap and keeps its percent within 0..100", async () => {
    const { unmount } = await renderIn("en", <ContextMeter used={10} cap={0} />);
    expect(screen.queryByRole("meter")).toBeNull();
    unmount();
    const { unmount: again } = await renderIn("en", <ContextMeter used={500_000} cap={200_000} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
    // The ring's arc draws the same percent.
    expect(screen.getByRole("meter").querySelector("circle + circle")?.getAttribute("stroke-dasharray")).toBe("100 100");
    again();
    await renderIn("en", <ContextMeter used={-5} cap={200_000} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("0");
  });
});

describe("StartView", () => {
  it("shows the topics in path order with their badges, then the rest, and starts them", async () => {
    const onStart = vi.fn();
    const s = state();
    s.actions.extra = { label: "Extra", description: "Not on the path", cost: "light" };
    await renderIn(
      "en",
      <StartView state={s} tasks={idle({ manifest: "done", turn: "unsaved" })} notice={null} disabled={false} onStart={onStart} onAsk={() => {}} />,
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
