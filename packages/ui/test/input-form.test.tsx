// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputIssue, InputSpec } from "../src/client";
import { AnswerView, InputForm } from "../src/InputForm";
import { renderIn } from "./render";

afterEach(cleanup);

const L = (en: string, es = en) => ({ es, en });
const commit: InputSpec = {
  fields: [
    { name: "choice", kind: "choice", label: L("I pick", "Elegí"), optional: true, optionsFrom: "options" },
    { name: "why", kind: "longText", label: L("Why? In your own words", "¿Por qué? Con tus palabras"), optional: false, min: 1, max: 1000 },
  ],
  submitLabel: L("I commit", "Me comprometo"),
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
    await renderIn("es", el);
    expect((screen.getByRole("button", { name: "Me comprometo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Saltear esta pregunta" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const open = form();
    await renderIn("es", open.el);
    fireEvent.click(screen.getByRole("button", { name: "Saltear esta pregunta" }));
    expect(open.skip).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("pairs: rows are added, and empty ones dropped; a field it can't draw blocks sending", async () => {
    const cards: InputSpec = {
      fields: [
        { name: "cards", kind: "pairs", label: L("Cards"), optional: false, columns: [{ name: "front", label: L("Front") }, { name: "back", label: L("Back") }] },
        { name: "sure", kind: "boolean", label: L("Sure"), optional: false },
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
    const deep: InputSpec = { fields: [{ name: "deep", kind: null, label: L("Deep"), optional: false }] };
    await renderIn("en", form({ spec: deep, blockId: "t1:0:7" }).el);
    expect(screen.getByText('The app can\'t show the field "Deep" here.')).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AnswerView", () => {
  it("reads the answer back in the window's language; a skip has its own words", async () => {
    await renderIn("es", <AnswerView spec={commit} answer={{ blockId: "t1:0:0", value: { choice: "Yo", why: "porque" }, answeredAt: "a" }} />);
    expect(screen.getByText("Tu respuesta")).toBeTruthy();
    expect(screen.getByText("Elegí")).toBeTruthy();
    expect(screen.getByText("Yo")).toBeTruthy();
    cleanup();
    await renderIn("en", <AnswerView spec={commit} answer={{ blockId: "t1:0:0", value: { skipped: true }, answeredAt: "a" }} />);
    expect(screen.getByText("You skipped this question.")).toBeTruthy();
  });
});
