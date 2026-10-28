// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageState } from "../src/client";
import { LanguageChooser } from "../src/LanguageChooser";
import type { LanguageControl } from "../src/language-control";
import { I18nextProvider } from "react-i18next";
import { renderIn } from "./render";

const view: LanguageState = { language: "en", cached: [], missing: 0, canTranslate: true, engineName: "Claude Code", run: null };

type Choose = Awaited<ReturnType<LanguageControl["choose"]>>;

function control(choose: Choose | Promise<Choose>, translate: boolean | Promise<boolean> = true, state: LanguageState | null = view) {
  const translated: string[] = [];
  const c = {
    view: state,
    load: vi.fn(),
    choose: vi.fn(async () => choose),
    translate: vi.fn(async (t: string) => (translated.push(t), translate)),
    cancel: vi.fn(),
    translated,
  };
  return c satisfies LanguageControl & { translated: string[] };
}

/** A promise and its resolve, to answer when the test says. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(cleanup);

describe("LanguageChooser (spec §3, §4)", () => {
  it("a language that needs a translation: picker, then the notice, then the run", async () => {
    const c = control("needs-translation");
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await screen.findByRole("alertdialog");
    expect(screen.queryByRole("dialog", { name: "Language" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(c.translated).toEqual(["es"]);
  });

  it("a complete language switches with no notice; straight to the notice for new texts", async () => {
    const c = control("switched");
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    cleanup();
    await renderIn("en", <LanguageChooser control={c} start={{ notice: "es" }} harnessName="Demo" onClose={() => {}} />);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Language" })).toBeNull();
    expect(fireEvent.mouseDown(screen.getByRole("alertdialog").parentElement!)).toBe(false);
  });

  it("asks for the state once on open, though the control object is new on every render", async () => {
    const c = control("switched", true, null);
    const { rerender, i18n } = await renderIn("en", <LanguageChooser control={c} start={{}} harnessName="Demo" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <I18nextProvider i18n={i18n}>
        <LanguageChooser control={{ ...c }} start={{}} harnessName="Demo" onClose={() => {}} />
      </I18nextProvider>,
    );
    expect(c.load).toHaveBeenCalledTimes(1);
  });

  it("a failed choice says so inside the picker and keeps it open", async () => {
    const c = control("failed");
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That didn't work. Try again.");
    expect(screen.getByRole("dialog", { name: "Language" }).contains(alert)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the picker is off while the choice is pending", async () => {
    const answer = later<Choose>();
    const c = control(answer.promise);
    await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(screen.getByRole("dialog", { name: "Language" }).getAttribute("aria-busy")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(c.choose).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve("needs-translation"));
    await screen.findByRole("alertdialog");
  });

  it("a run that didn't start keeps the notice open and says so; Translate is off while it starts", async () => {
    const started = later<boolean>();
    const c = control("needs-translation", started.promise);
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ notice: "es" }} harnessName="Demo" onClose={onClose} />);
    const translate = screen.getByRole("button", { name: "Translate" }) as HTMLButtonElement;
    fireEvent.click(translate);
    expect(translate.disabled).toBe(true);
    fireEvent.click(translate);
    expect(c.translate).toHaveBeenCalledTimes(1);
    await act(async () => started.resolve(false));
    const alert = await screen.findByRole("alert");
    expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);
    expect(translate.disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel or Escape while the run is starting cancels it, so it never switches the language", async () => {
    for (const how of ["click", "escape"] as const) {
      const started = later<boolean>();
      const c = control("needs-translation", started.promise);
      const onClose = vi.fn();
      await renderIn("en", <LanguageChooser control={c} start={{ notice: "es" }} harnessName="Demo" onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Translate" }));
      if (how === "click") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      else fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
      expect(c.cancel).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      await act(async () => started.resolve(false));
      cleanup();
    }
  });

  it("Cancel on the notice before Translate cancels nothing", async () => {
    const c = control("needs-translation");
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{ notice: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(c.cancel).not.toHaveBeenCalled();
  });

  it("the notice with no engine (or in mock mode): Translate is off and it says why", async () => {
    for (const canTranslate of ["no-engine", "mock"] as const) {
      const c = control("needs-translation", true, { ...view, canTranslate, engineName: undefined });
      await renderIn("en", <LanguageChooser control={c} start={{ notice: "es" }} harnessName="Demo" onClose={() => {}} />);
      const translate = screen.getByRole("button", { name: "Translate" }) as HTMLButtonElement;
      expect(translate.disabled).toBe(true);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Connect an AI engine to translate the app.");
      expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);
      fireEvent.click(translate);
      expect(c.translate).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("focus goes back to the opener after picker → notice → close, and after the progress closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    try {
      opener.focus();
      const c = control("needs-translation");
      const { rerender, i18n } = await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "Use" }));
      await screen.findByRole("alertdialog");
      expect(document.activeElement?.textContent).toBe("Cancel");
      rerender(<I18nextProvider i18n={i18n}>{null}</I18nextProvider>);
      expect(document.activeElement).toBe(opener);
      cleanup();

      opener.focus();
      const running: LanguageState = { ...view, run: { tag: "es", done: 1, total: 5, status: "running" } };
      const r = await renderIn("en", <LanguageChooser control={control("switched", true, running)} start={{}} harnessName="Demo" onClose={() => {}} />);
      expect(document.activeElement?.textContent).toBe("Close");
      r.rerender(<I18nextProvider i18n={r.i18n}>{null}</I18nextProvider>);
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it("drops an answer that comes after the chooser closed", async () => {
    const answer = later<Choose>();
    const c = control(answer.promise);
    const onClose = vi.fn();
    const { unmount } = await renderIn("en", <LanguageChooser control={c} start={{ pick: "es" }} harnessName="Demo" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => answer.resolve("switched"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("while a run is going: its progress and Cancel instead of the picker; closes when the run ends", async () => {
    const running: LanguageState = { ...view, run: { tag: "es", done: 2, total: 5, status: "running" } };
    const c = control("switched", true, running);
    const onClose = vi.fn();
    const { rerender, i18n } = await renderIn("en", <LanguageChooser control={c} start={{}} harnessName="Demo" onClose={onClose} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Language" });
    expect(dialog.textContent).toContain("Translating… 2 of 5");
    expect(document.activeElement?.textContent).toBe("Close");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.cancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <I18nextProvider i18n={i18n}>
        <LanguageChooser control={{ ...c, view: { ...running, run: { tag: "es", done: 2, total: 5, status: "cancelled" } } }} start={{}} harnessName="Demo" onClose={onClose} />
      </I18nextProvider>,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the progress closes on Close and on Escape, without cancelling the run", async () => {
    const running: LanguageState = { ...view, run: { tag: "es", done: 0, total: 5, status: "running" } };
    const c = control("switched", true, running);
    const onClose = vi.fn();
    await renderIn("en", <LanguageChooser control={c} start={{}} harnessName="Demo" onClose={onClose} />);
    // A press on the backdrop doesn't take focus out of the dialog (its Tab trap and Escape live on the dialog).
    expect(fireEvent.mouseDown(screen.getByRole("dialog").parentElement!)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(c.cancel).not.toHaveBeenCalled();
  });
});
