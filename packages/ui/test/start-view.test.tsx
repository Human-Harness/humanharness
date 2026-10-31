// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, TaskView } from "../src/client";
import { StartView } from "../src/StartView";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function state(): AppState {
  const s = new FakeClient().state;
  s.actions = {
    manifest: { label: "The manifest", cost: "medium" },
    engines: { label: "Engines", cost: "medium" },
    turn: { label: "A turn end to end", cost: "medium", tier: "deep" },
    blocks: { label: "Blocks", cost: "medium", tier: "standard" },
    extra: { label: "Extra", cost: "light" },
    tools: { label: "Tools", cost: "light", tier: "light" },
  };
  s.path = ["manifest", "engines", "turn", "blocks"];
  return s;
}
const view = (actions: TaskView["actions"] = {}): TaskView => ({ current: null, actions, notes: [] });
const memory = () => {
  const store = new Map<string, string>();
  return { store, storage: { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) } };
};

describe("StartView in the soft-cards look (UI refresh spec §5.3)", () => {
  it("switches between Cards and List and remembers the choice per harness", async () => {
    const { store, storage } = memory();
    const s = state();
    const props = { state: s, tasks: view(), notice: null, disabled: false, onStart: () => {}, onAsk: () => {}, storage };
    const { unmount } = await renderIn("en", <StartView {...props} />);
    const switcher = screen.getByRole("group", { name: "View" });
    expect(within(switcher).getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("list", { name: "Topics" }).className).toBe("hh-topics");
    fireEvent.click(within(switcher).getByRole("button", { name: "List" }));
    expect(screen.getByRole("list", { name: "Topics" }).className).toContain("hh-topics-list");
    expect(store.get(`hh.start.view.${s.harness.id}`)).toBe("list");
    unmount();
    const again = await renderIn("en", <StartView {...props} />);
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    again.unmount();
    // Another harness keeps its own choice.
    const other = { ...s, harness: { ...s.harness, id: "other" } };
    await renderIn("en", <StartView {...props} state={other} />);
    expect(screen.getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to Cards when the storage can't be read or written", async () => {
    const storage = {
      get: () => {
        throw new Error("blocked");
      },
      set: () => {
        throw new Error("blocked");
      },
    };
    await renderIn("en", <StartView state={state()} tasks={view()} notice={null} disabled={false} onStart={() => {}} onAsk={() => {}} storage={storage} />);
    expect(screen.getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tags each topic with its state and tier, numbers it, outlines the next one and counts the done ones", async () => {
    const { storage } = memory();
    await renderIn(
      "en",
      <StartView state={state()} tasks={view({ manifest: "done", engines: "done" })} notice={null} disabled={false} onStart={() => {}} onAsk={() => {}} storage={storage} />,
    );
    const topics = screen.getByRole("list", { name: "Topics" });
    const turn = within(topics).getByRole("button", { name: /A turn end to end/ });
    expect(within(turn).getByText("Up next").className).toContain("hh-tag-orange");
    expect(within(turn).getByText("Deep").className).toContain("hh-tag-violet");
    expect(within(turn).getByText("03")).toBeTruthy();
    expect(turn.className).toContain("hh-topic-next");
    const manifest = within(topics).getByRole("button", { name: /The manifest/ });
    expect(within(manifest).getByText("Done").className).toContain("hh-tag-green");
    expect(manifest.className).not.toContain("hh-topic-next");
    const blocks = within(topics).getByRole("button", { name: /Blocks/ });
    expect(within(blocks).getByText("To do").className).toContain("hh-tag-gray");
    expect(within(blocks).getByText("Standard").className).toContain("hh-tag-blue");
    expect(within(within(topics).getByRole("button", { name: /Tools/ })).getByText("Light").className).toContain("hh-tag-green");
    // No tier declared: no tier tag (D0).
    expect(within(within(topics).getByRole("button", { name: /Extra/ })).queryByText(/Light|Standard|Deep/)).toBeNull();
    // The tags are what the eye reads; the topic keeps the name it had.
    expect(turn.getAttribute("aria-label")).toBeNull();
    expect(within(topics).getByRole("button", { name: "A turn end to end Next on the path" })).toBe(turn);
    expect(screen.getByRole("heading", { name: "Guided path" })).toBeTruthy();
    expect(screen.getByText("2 / 6 done")).toBeTruthy();
  });

  it("titles the frequent questions 'Or ask straight away'", async () => {
    const { storage } = memory();
    await renderIn(
      "en",
      <StartView state={state()} tasks={view()} copy={{ faq: ["q.one"] }} notice={null} disabled={false} onStart={() => {}} onAsk={() => {}} storage={storage} />,
    );
    expect(screen.getByRole("heading", { name: "Or ask straight away" })).toBeTruthy();
  });
});
