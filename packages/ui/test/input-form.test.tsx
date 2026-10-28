// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputIssue, InputSpec } from "../src/client";
import { AnswerView, InputForm } from "../src/InputForm";
import { draftOf, draftValue } from "../src/input";
import { renderIn } from "./render";

afterEach(cleanup);

const commit: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: "I pick", optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: "Why? In your own words", optional: false, min: 1, max: 1000 },
  ],
  submitLabel: "I commit",
  skippable: true,
};
const data = { question: "Who ate more?", options: ["Me", "Both the same"] };

function form(over: { spec?: InputSpec; blockId?: string; disabled?: boolean; errors?: InputIssue[] } = {}) {
  const submit = vi.fn();
  const skip = vi.fn();
  const el = (
    <InputForm
      spec={over.spec ?? commit}
      data={data}
      blockId={over.blockId ?? "t1:0:0"}
      disabled={over.disabled ?? false}
      sending={false}
      errors={over.errors ?? []}
      submit={submit}
      skip={skip}
    />
  );
  return { submit, skip, el };
}

describe("InputForm", () => {
  it("draws a choice from the shown options and a labelled long text, and sends the value", async () => {
    const { submit, el } = form();
    await renderIn("en", el);
    fireEvent.click(screen.getByRole("radio", { name: "Both the same" }));
    fireEvent.change(screen.getByLabelText("Why? In your own words"), { target: { value: "two halves" } });
    fireEvent.click(screen.getByRole("button", { name: "I commit" }));
    expect(submit).toHaveBeenCalledWith({ choice: "Both the same", why: "two halves" });
  });

  it("shows each error next to its field, with a summary", async () => {
    const { el } = form({ errors: [{ path: "why", message: "Too small" }] });
    await renderIn("en", el);
    expect(screen.getByRole("alert").textContent).toContain("Check the marked fields.");
    const why = screen.getByLabelText("Why? In your own words");
    expect(why.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(why.getAttribute("aria-describedby")!)?.textContent).toBe("Too small");
  });

  it("a form-level error is shown alone", async () => {
    const { el } = form({ errors: [{ path: "", message: "This question is closed." }] });
    await renderIn("en", el);
    expect(screen.getByRole("alert").textContent).toBe("This question is closed.");
  });

  it("keeps a draft when the form is drawn again", async () => {
    const first = form({ blockId: "t1:0:5" });
    await renderIn("en", first.el);
    fireEvent.change(screen.getByLabelText("Why? In your own words"), { target: { value: "half" } });
    cleanup();
    await renderIn("en", form({ blockId: "t1:0:5" }).el);
    expect((screen.getByLabelText("Why? In your own words") as HTMLTextAreaElement).value).toBe("half");
  });

  it("skips; a disabled form sends nothing", async () => {
    const { skip, submit, el } = form({ disabled: true });
    await renderIn("en", el);
    expect((screen.getByRole("button", { name: "I commit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip this question" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const open = form();
    await renderIn("en", open.el);
    fireEvent.click(screen.getByRole("button", { name: "Skip this question" }));
    expect(open.skip).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("pairs: rows are added, and empty ones dropped; a field it can't draw blocks sending", async () => {
    const cards: InputSpec = {
      fields: [
        { name: "cards", kind: "pairs", label: "Cards", optional: false, columns: [{ name: "front", label: "Front" }, { name: "back", label: "Back" }] },
        { name: "sure", kind: "boolean", label: "Sure", optional: false },
      ],
    };
    const { submit, el } = form({ spec: cards, blockId: "t1:0:6" });
    await renderIn("en", el);
    fireEvent.change(screen.getByLabelText("Front 1"), { target: { value: "2+2" } });
    fireEvent.change(screen.getByLabelText("Back 1"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ cards: [{ front: "2+2", back: "4" }], sure: true });
    cleanup();
    const deep: InputSpec = { fields: [{ name: "deep", kind: null, label: "Deep", optional: false }] };
    await renderIn("en", form({ spec: deep, blockId: "t1:0:7" }).el);
    expect(screen.getByText('The app can\'t show the field "Deep" here.')).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("grouped fields mark their inner inputs invalid; multiChoice keeps the options' order", async () => {
    const grouped: InputSpec = {
      fields: [
        { name: "tags", kind: "multiChoice", label: "Tags", optional: false, options: ["a", "b", "c"] },
        { name: "cards", kind: "pairs", label: "Cards", optional: false, columns: [{ name: "front", label: "Front" }, { name: "back", label: "Back" }] },
      ],
    };
    const { submit, el } = form({ spec: grouped, blockId: "t1:0:8", errors: [{ path: "tags", message: "Pick one" }, { path: "cards.0.front", message: "Empty" }] });
    await renderIn("en", el);
    for (const box of [screen.getByRole("checkbox", { name: "a" }), screen.getByLabelText("Front 1")]) {
      expect(box.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(box.getAttribute("aria-describedby")!)?.textContent).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "c" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
    fireEvent.change(screen.getByLabelText("Front 1"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Back 1"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ tags: ["a", "c"], cards: [{ front: "x", back: "y" }] });
  });

  it("pairs: removing a row keeps the others' inputs and moves focus to the row in its place", async () => {
    const cards: InputSpec = {
      fields: [{ name: "cards", kind: "pairs", label: "Cards", optional: false, columns: [{ name: "front", label: "Front" }, { name: "back", label: "Back" }] }],
    };
    await renderIn("en", form({ spec: cards, blockId: "t1:0:9" }).el);
    fireEvent.change(screen.getByLabelText("Front 1"), { target: { value: "one" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fireEvent.change(screen.getByLabelText("Front 2"), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fireEvent.change(screen.getByLabelText("Front 3"), { target: { value: "three" } });
    const third = screen.getByLabelText("Front 3");
    fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect((screen.getByLabelText("Front 1") as HTMLInputElement).value).toBe("two");
    // The old third row's input is the same element, now second.
    expect(screen.getByLabelText("Front 2")).toBe(third);
    expect(document.activeElement).toBe(screen.getByLabelText("Front 1"));
  });
});

describe("AnswerView", () => {
  it("reads the answer back with the harness's labels; a skip has its own words", async () => {
    await renderIn("en", <AnswerView spec={commit} answer={{ blockId: "t1:0:0", value: { choice: "Yo", why: "porque" }, answeredAt: "a" }} />);
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.getByText("I pick")).toBeTruthy();
    expect(screen.getByText("Yo")).toBeTruthy();
    cleanup();
    await renderIn("en", <AnswerView spec={commit} answer={{ blockId: "t1:0:0", value: { skipped: true }, answeredAt: "a" }} />);
    expect(screen.getByText("You skipped this question.")).toBeTruthy();
  });
});

describe("InputForm for a setup step (setup-steps spec §3 `form`)", () => {
  const spec: InputSpec = {
    fields: [
      { name: "goal", kind: "text", label: "Goal", optional: false, max: 200 },
      { name: "age", kind: "number", label: "Age", optional: true, min: 5, max: 99 },
      { name: "tone", kind: "choice", label: "Tone", optional: false, options: ["patient", "demanding"], optionLabels: { patient: "Patient", demanding: "Demanding" } },
      { name: "examples", kind: "boolean", label: "Show examples", optional: false },
    ],
  };

  it("starts from saved values and shows the options' labels, sending the values", async () => {
    const submit = vi.fn();
    await renderIn(
      "en",
      <InputForm spec={spec} data={null} initial={{ goal: "Pass", age: 12, tone: "demanding", examples: true }} disabled={false} sending={false} errors={[]} submit={submit} />,
    );
    expect((screen.getByLabelText("Goal") as HTMLInputElement).value).toBe("Pass");
    expect((screen.getByLabelText(/^Age/) as HTMLInputElement).value).toBe("12");
    expect((screen.getByRole("radio", { name: "Demanding" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Show examples" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Patient" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ goal: "Pass", age: 12, tone: "patient", examples: true });
  });

  it("with a formId it draws no buttons of its own: a button outside submits it", async () => {
    const submit = vi.fn();
    await renderIn(
      "en",
      <>
        <InputForm spec={spec} data={null} formId="setup-form" initial={{ goal: "Pass", tone: "patient" }} disabled={false} sending={false} errors={[]} submit={submit} />
        <button type="submit" form="setup-form">
          Next
        </button>
      </>,
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(submit).toHaveBeenCalledWith({ goal: "Pass", tone: "patient", examples: false });
  });

  it("draftOf keeps only a pairs field's object rows, each cell a string of the field's columns", () => {
    const cards: InputSpec = {
      fields: [{ name: "cards", kind: "pairs", label: "Cards", optional: true, columns: [{ name: "front", label: "Front" }, { name: "back", label: "Back" }] }],
    };
    const saved = { cards: ["front", null, [1, 2], { front: "Hola", back: 7, extra: "x" }, { front: "Adiós" }] };
    expect(draftOf(cards, saved)).toEqual({ cards: [{ front: "Hola", back: "7" }, { front: "Adiós", back: "" }] });
    expect(draftValue(cards, draftOf(cards, saved))).toEqual({ cards: [{ front: "Hola", back: "7" }, { front: "Adiós", back: "" }] });
    expect(draftOf(cards, { cards: ["only", "strings"] })).toEqual({ cards: [{}] });
  });
});

describe("Sidekick on free-text answers (sidekick spec §4.1)", () => {
  const TEXT: InputSpec = { fields: [{ name: "why", kind: "longText", label: "Why?", optional: false }] };
  const CHOICE: InputSpec = { fields: [{ name: "pick", kind: "choice", label: "Pick", optional: false, options: ["a", "b"] }] };
  type Review = NonNullable<Parameters<typeof InputForm>[0]["review"]>;
  function textForm(over: { spec?: InputSpec; review?: Review; cancelReview?: () => void; skip?: () => void } = {}) {
    const submit = vi.fn();
    const el = (
      <InputForm
        spec={over.spec ?? TEXT}
        data={null}
        disabled={false}
        sending={false}
        errors={[]}
        submit={submit}
        {...(over.skip ? { skip: over.skip } : {})}
        {...(over.review ? { review: over.review } : {})}
        {...(over.cancelReview ? { cancelReview: over.cancelReview } : {})}
      />
    );
    return { submit, el };
  }
  const answer = (text: string) => fireEvent.change(screen.getByLabelText("Why?"), { target: { value: text } });

  it("a free-text answer goes through review first; a card holds it", async () => {
    const review = vi.fn<Review>(async () => ({ kind: "card" }));
    const { submit, el } = textForm({ review });
    await renderIn("en", el);
    answer("make it better");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith("make it better", expect.anything()));
    // The form is back as it was, the answer still in it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).toBeNull());
    expect(submit).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Why?") as HTMLTextAreaElement).value).toBe("make it better");
  });

  it("send → submits as before; any failure submits too", async () => {
    for (const review of [async () => ({ kind: "send" as const }), async () => Promise.reject(new Error("down"))]) {
      const { submit, el } = textForm({ review });
      await renderIn("en", el);
      answer("ok");
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(submit).toHaveBeenCalledWith({ why: "ok" }));
      cleanup();
    }
  });

  it("a card's Send anyway submits the form without another review", async () => {
    let hold: Parameters<Review>[1] | undefined;
    const review = vi.fn<Review>(async (_text, h) => {
      hold = h;
      return { kind: "card" };
    });
    const { submit, el } = textForm({ review });
    await renderIn("en", el);
    answer("make it better");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(hold).toBeDefined());
    act(() => hold!.anyway());
    expect(submit).toHaveBeenCalledWith({ why: "make it better" });
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("while it reviews: one review only, and Send now stops it and submits", async () => {
    let answerReview: (v: { kind: "send" }) => void = () => undefined;
    const review = vi.fn<Review>(() => new Promise((r) => (answerReview = r)));
    const cancelReview = vi.fn();
    const { submit, el } = textForm({ review, cancelReview });
    await renderIn("en", el);
    answer("ok");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const busy = await screen.findByRole("button", { name: "Reviewing…" });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(busy);
    fireEvent.submit(busy.closest("form")!);
    expect(review).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(cancelReview).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    // The late answer changes nothing.
    await act(async () => answerReview({ kind: "send" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("D0: without `review`, with choices only, an empty text or a skip, nothing is reviewed", async () => {
    const plain = textForm();
    await renderIn("en", plain.el);
    answer("ok");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(plain.submit).toHaveBeenCalledWith({ why: "ok" });
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();
    cleanup();
    const review = vi.fn<Review>(async () => ({ kind: "card" }));
    const choice = textForm({ spec: CHOICE, review });
    await renderIn("en", choice.el);
    fireEvent.click(screen.getByRole("radio", { name: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(choice.submit).toHaveBeenCalledWith({ pick: "a" });
    cleanup();
    const skip = vi.fn();
    const empty = textForm({ review, skip });
    await renderIn("en", empty.el);
    answer("   ");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(empty.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Skip this question" }));
    expect(skip).toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
});
