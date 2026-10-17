// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerPart } from "../src/client";
import { Message } from "../src/Message";
import { type Reveal, NOTHING, answerPace, revealed, step, usePacedAnswer, wordsOf } from "../src/pace";

const parts: AnswerPart[] = [{ text: "One two three." }, { block: 0 }, { text: "Four five." }];
const run = (from: Reveal, final: boolean, times: number, p = parts) => {
  let r = from;
  for (let i = 0; i < times; i++) r = step(p, r, final);
  return r;
};

describe("wordsOf", () => {
  it("keeps each word's whitespace, so a prefix of words is a prefix of the text", () => {
    expect(wordsOf("Hello  there\n\nfriend")).toEqual(["Hello  ", "there\n\n", "friend"]);
    expect(wordsOf("Hello  there\n\nfriend").slice(0, 2).join("")).toBe("Hello  there\n\n");
  });
});

describe("step", () => {
  it("shows a word per tick, then the block on a tick of its own, then the next text", () => {
    expect(run(NOTHING, true, 1)).toEqual({ part: 0, words: 1 });
    expect(run(NOTHING, true, 3)).toEqual({ part: 1, words: 0 });
    expect(run(NOTHING, true, 4)).toEqual({ part: 2, words: 0 });
    expect(run(NOTHING, true, 5)).toEqual({ part: 2, words: 1 });
    expect(run(NOTHING, true, 7)).toEqual({ part: 3, words: 0 });
    expect(revealed(parts, run(NOTHING, true, 7), true)).toBe(true);
  });

  it("waits at the end of the last text run while the turn may still add to it", () => {
    const live: AnswerPart[] = [{ text: "One two" }];
    const r = run(NOTHING, false, 5, live);
    expect(r).toEqual({ part: 0, words: 2 });
    expect(revealed(live, r, false)).toBe(true);
    expect(revealed(live, r, true)).toBe(false);
    expect(step(live, r, true)).toEqual({ part: 1, words: 0 });
  });

  it("shows more than a word per tick when far behind", () => {
    const long: AnswerPart[] = [{ text: "word ".repeat(200) }];
    expect(step(long, NOTHING, false).words).toBe(5);
  });
});

describe("usePacedAnswer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    answerPace.wordMs = 110;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    answerPace.wordMs = 0;
  });

  function Probe({ turn, parts, final }: { turn: string; parts: AnswerPart[] | null; final: boolean }) {
    const r = usePacedAnswer(turn, parts, final);
    return <p>{r === null ? "all" : `${r.part}:${r.words}`}</p>;
  }

  /** `n` ticks: each one renders before the next is scheduled. */
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) act(() => vi.advanceTimersByTime(110));
  };

  it("reveals at a steady pace, waits for more, keeps going after the turn ends, then stops pacing", () => {
    const live: AnswerPart[] = [{ text: "One two" }];
    const { container, rerender } = render(<Probe turn="t1" parts={live} final={false} />);
    expect(container.textContent).toBe("0:0");
    act(() => vi.advanceTimersByTime(100));
    expect(container.textContent).toBe("0:0");
    tick();
    expect(container.textContent).toBe("0:1");
    // Caught up while the turn runs: it waits, with no timer going.
    tick(5);
    expect(container.textContent).toBe("0:2");
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Probe turn="t1" parts={parts} final />);
    tick();
    expect(container.textContent).toBe("1:0");
    tick();
    expect(container.textContent).toBe("2:0");
    tick(3);
    expect(container.textContent).toBe("all");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts over for a new turn", () => {
    const { container, rerender } = render(<Probe turn="t1" parts={parts} final />);
    tick(2);
    expect(container.textContent).toBe("0:2");
    rerender(<Probe turn="t2" parts={parts} final />);
    expect(container.textContent).toBe("0:0");
  });

  it("does nothing without parts or with the pace off", () => {
    const { container, rerender } = render(<Probe turn="t1" parts={null} final={false} />);
    expect(container.textContent).toBe("all");
    answerPace.wordMs = 0;
    rerender(<Probe turn="t1" parts={parts} final={false} />);
    expect(container.textContent).toBe("all");
  });
});

describe("Message with an answer arriving", () => {
  afterEach(cleanup);
  const Box = ({ data }: { data: unknown }) => <div>box {String(data)}</div>;
  const entry = { role: "assistant" as const, text: "One two three.\n\nFour five.", blocks: [{ name: "box", data: 1 }], activities: [], parts };
  const actions = { respond: () => true, choose: () => true, open: async () => true, reveal: async () => true, active: false };

  it("shows only what is revealed, each word and block fading in", () => {
    const { container } = render(<Message entry={entry} components={{ box: Box }} actions={actions} reveal={{ part: 2, words: 1 }} />);
    expect(container.textContent).toBe("One two three.box 1Four ");
    expect([...container.querySelectorAll(".hh-word")].map((w) => w.textContent)).toEqual(["One", "two", "three.", "Four"]);
    expect(container.querySelector(".hh-block")?.className).toBe("hh-block hh-appear");
  });

  it("hides a block until its turn comes", () => {
    const { container } = render(<Message entry={entry} components={{ box: Box }} actions={actions} reveal={{ part: 1, words: 0 }} />);
    expect(container.textContent).toBe("One two three.");
  });

  it("shows a finished answer whole and still, in the order it arrived", () => {
    const { container } = render(<Message entry={entry} components={{ box: Box }} actions={actions} />);
    expect(container.textContent).toBe("One two three.box 1Four five.");
    expect(container.querySelector(".hh-word, .hh-appear")).toBeNull();
  });

  it("shows an answer saved before parts existed as its text, then its blocks", () => {
    const { container } = render(<Message entry={{ ...entry, parts: undefined }} components={{ box: Box }} actions={actions} />);
    expect(container.textContent).toBe("One two three.Four five.box 1");
  });
});
