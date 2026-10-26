// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockProps } from "../src/Message";
import { ModeBar } from "../src/ModeList";
import { RecommendModeBlock } from "../src/RecommendModeBlock";
import { actionModes, readRecommendation, tierBelow } from "../src/modes";
import { renderIn } from "./render";

afterEach(cleanup);

const views = {
  socratic: { label: "Socratic", description: "Questions that lead you to the idea." },
  feynman: { label: "Feynman" },
  worked: { label: "Worked examples", minTier: "deep" as const },
};
const allowed = ["socratic", "feynman", "worked"];
const data = {
  recommended: "socratic",
  reasons: ["One key idea to discover.", "You like to reason it out."],
  alternatives: [{ mode: "worked", why: "If you want to see it solved first." }],
};
const props = (over: Partial<BlockProps> = {}): BlockProps => ({
  data,
  respond: () => true,
  choose: () => true,
  open: async () => true,
  reveal: async () => true,
  active: true,
  chooseMode: vi.fn(() => true),
  modes: { views, allowed },
  ...over,
});

describe("RecommendModeBlock (task-modes spec §4)", () => {
  it("shows the recommended mode first with its badge and reasons, then the alternatives; a pick goes to chooseMode", async () => {
    const p = props();
    await renderIn("en", <RecommendModeBlock {...p} />);
    const group = screen.getByRole("group", { name: "How do we work?" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("SocraticRecommendedOne key idea to discover.You like to reason it out.");
    expect(buttons[1].textContent).toBe("Worked examplesIf you want to see it solved first.");
    fireEvent.click(buttons[0]);
    expect(p.chooseMode).toHaveBeenCalledWith("socratic");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("'See all modes' lists the action's modes with their descriptions", async () => {
    const p = props();
    await renderIn("en", <RecommendModeBlock {...p} />);
    const more = screen.getByRole("button", { name: "See all modes" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    const list = screen.getByRole("group", { name: "See all modes" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "SocraticQuestions that lead you to the idea.",
      "Feynman",
      "Worked examples",
    ]);
    fireEvent.click(within(list).getByRole("button", { name: "Feynman" }));
    expect(p.chooseMode).toHaveBeenCalledWith("feynman");
  });

  it("'See all modes' marks the mode just picked, else the task's mode", async () => {
    await renderIn("en", <RecommendModeBlock {...props({ modes: { views, allowed, current: "feynman" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "See all modes" }));
    const list = screen.getByRole("group", { name: "See all modes" });
    expect(within(list).getByRole("button", { name: "Feynman" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(list).getByRole("button", { name: /^Socratic/ }));
    expect(within(list).getByRole("button", { name: /^Socratic/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(list).getByRole("button", { name: "Feynman" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("stays unpicked when the switch isn't sent; is disabled once the conversation moved on; draws nothing when malformed", async () => {
    const refused = props({ chooseMode: vi.fn(() => false) });
    const { unmount } = await renderIn("en", <RecommendModeBlock {...refused} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-pressed")).toBe("false");
    unmount();
    await renderIn(
      "en",
      <>
        <RecommendModeBlock {...props({ active: false })} />
        <RecommendModeBlock {...props({ data: { recommended: "nope", reasons: ["x"] } })} />
        <RecommendModeBlock {...props({ modes: undefined })} />
      </>,
    );
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getAllByRole("button").filter((b) => b.textContent !== "See all modes").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("readRecommendation", () => {
  it("keeps only listed modes, well-formed reasons (at most 3) and alternatives (at most 2, never the recommended one)", () => {
    expect(
      readRecommendation(
        {
          recommended: "socratic",
          reasons: ["a", "", 3, "b", "c", "d"],
          alternatives: [{ mode: "socratic", why: "x" }, { mode: "nope", why: "x" }, { mode: "feynman" }, { mode: "worked", why: "w" }, { mode: "worked", why: "again" }],
        },
        allowed,
      ),
    ).toEqual({ recommended: "socratic", reasons: ["a", "b", "c"], alternatives: [{ mode: "worked", why: "w" }] });
    expect(readRecommendation({ recommended: "nope", reasons: ["a"] }, allowed)).toBeNull();
    expect(readRecommendation({ recommended: "socratic", reasons: [] }, allowed)).toBeNull();
    expect(readRecommendation(null, allowed)).toBeNull();
  });

  it("drops whitespace-only reasons and whys", () => {
    expect(
      readRecommendation({ recommended: "socratic", reasons: ["  ", "a"], alternatives: [{ mode: "feynman", why: " \n" }, { mode: "worked", why: "w" }] }, allowed),
    ).toEqual({ recommended: "socratic", reasons: ["a"], alternatives: [{ mode: "worked", why: "w" }] });
    expect(readRecommendation({ recommended: "socratic", reasons: [" "] }, allowed)).toBeNull();
  });
});

describe("the mode helpers and the bar", () => {
  it("tierBelow and actionModes", () => {
    expect(tierBelow("standard", "deep")).toBe(true);
    expect(tierBelow("deep", "deep")).toBe(false);
    const state = { actions: { study: { label: "Study", cost: "medium" as const, modes: ["worked", "gone", "socratic"] }, quiz: { label: "Quiz", cost: "medium" as const } }, modes: views };
    expect(actionModes(state, "study")).toEqual([
      { id: "worked", label: "Worked examples", minTier: "deep" },
      { id: "socratic", label: "Socratic", description: "Questions that lead you to the idea." },
    ]);
    expect(actionModes(state, "quiz")).toEqual([]);
    expect(actionModes({ actions: state.actions }, "study")).toEqual([]);
  });

  it("names the mode, offers to change it, and says when the task runs below the mode's level", async () => {
    const onPick = vi.fn();
    const modes = actionModes({ actions: { study: { label: "Study", cost: "medium" as const, modes: allowed } }, modes: views }, "study");
    await renderIn("en", <ModeBar modes={modes} current="worked" below disabled={false} onPick={onPick} />);
    const bar = screen.getByRole("group", { name: "Task mode" });
    expect(bar.textContent).toContain("Mode: Worked examples");
    expect(bar.textContent).toContain("Running below the level this mode asks for");
    fireEvent.click(within(bar).getByRole("button", { name: "Change mode" }));
    const list = within(bar).getByRole("group", { name: "Change mode" });
    expect(within(list).getByRole("button", { name: "Worked examples" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(list).getByRole("button", { name: "Feynman" }));
    expect(onPick).toHaveBeenCalledWith("feynman");
    cleanup();
    await renderIn("en", <ModeBar modes={modes} disabled onPick={onPick} />);
    expect(screen.getByRole("group", { name: "Task mode" }).textContent).toContain("No mode chosen yet");
    expect((screen.getByRole("button", { name: "Change mode" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Escape closes the list and gives focus back to 'Change mode'", async () => {
    const modes = actionModes({ actions: { study: { label: "Study", cost: "medium" as const, modes: allowed } }, modes: views }, "study");
    await renderIn("en", <ModeBar modes={modes} disabled={false} onPick={() => {}} />);
    const change = screen.getByRole("button", { name: "Change mode" });
    fireEvent.click(change);
    expect(change.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("button", { name: "Feynman" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Change mode" })).toBeNull();
    expect(change.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(change);
  });

  it("a pick closes the list and gives focus back to 'Change mode'", async () => {
    const modes = actionModes({ actions: { study: { label: "Study", cost: "medium" as const, modes: allowed } }, modes: views }, "study");
    await renderIn("en", <ModeBar modes={modes} disabled={false} onPick={() => {}} />);
    const change = screen.getByRole("button", { name: "Change mode" });
    fireEvent.click(change);
    fireEvent.click(screen.getByRole("button", { name: "Feynman" }));
    expect(screen.queryByRole("group", { name: "Change mode" })).toBeNull();
    expect(document.activeElement).toBe(change);
  });
});
