// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageState } from "../src/client";
import { LanguagePicker, readyLanguage } from "../src/LanguagePicker";
import { renderIn } from "./render";

const view: LanguageState = { language: "en", cached: [{ tag: "fr", complete: true }], missing: 0, canTranslate: true, run: null };
const radioText = (r: HTMLElement) => r.closest("label")?.textContent ?? "";
/** Whether a control can be used (not disabled). */
const on = (el: HTMLElement) => !(el as HTMLInputElement | HTMLButtonElement).disabled;
const checked = (el: HTMLElement) => (el as HTMLInputElement).checked;

afterEach(cleanup);

describe("LanguagePicker (spec §2, §3)", () => {
  it("lists languages by their own name with the English name under, the suggestion selected, no RTL", async () => {
    const onPick = vi.fn();
    await renderIn("en", <LanguagePicker current="en" suggested="es" view={view} onPick={onPick} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Language" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(checked(screen.getByRole("radio", { name: /Español.*Spanish/ }))).toBe(true);
    expect(screen.queryByRole("radio", { name: /Arabic/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Français.*French.*Ready/ })).toBeTruthy();
    expect(radioText(screen.getAllByRole("radio")[0])).toMatch(/^English/);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenCalledWith("es");
  });

  it("filters by search; without an engine only English and complete languages can be picked, and it says why", async () => {
    for (const canTranslate of ["mock", "no-engine"] as const) {
      const { unmount } = await renderIn("en", <LanguagePicker current="en" suggested="es" view={{ ...view, canTranslate }} onPick={() => {}} onClose={() => {}} />);
      expect(screen.getByText("Connect an AI engine to translate the app.")).toBeTruthy();
      expect(on(screen.getByRole("radio", { name: /Español/ }))).toBe(false);
      // A suggestion that can't be used now isn't preselected.
      expect(checked(screen.getByRole("radio", { name: /Español/ }))).toBe(false);
      expect(on(screen.getByRole("radio", { name: /English/ }))).toBe(true);
      expect(on(screen.getByRole("radio", { name: /Français/ }))).toBe(true);
      const before = screen.getAllByRole("radio").length;
      fireEvent.change(screen.getByRole("searchbox", { name: "Search languages" }), { target: { value: "port" } });
      const after = screen.getAllByRole("radio");
      expect(after.length).toBeGreaterThan(0);
      expect(after.length).toBeLessThan(before);
      expect(after.every((r) => /Portuguese/.test(radioText(r)))).toBe(true);
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "espa" } });
      expect(screen.getAllByRole("radio").map(radioText)).toEqual([expect.stringMatching(/^Español/)]);
      unmount();
    }
  });

  it("canonicalizes the saved, cached and suggested tags (pt-br is pt-BR)", async () => {
    await renderIn("en", <LanguagePicker current="en" suggested="pt-br" view={{ ...view, cached: [{ tag: "PT-br", complete: true }] }} onPick={() => {}} onClose={() => {}} />);
    const pt = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).value.toLowerCase() === "pt-br");
    expect(pt.map((r) => (r as HTMLInputElement).value)).toEqual(["pt-BR"]);
    expect(checked(pt[0])).toBe(true);
    expect(radioText(pt[0])).toMatch(/Ready/);
    expect(readyLanguage(view, "en-GB")).toBe(true);
    expect(readyLanguage(view, "FR")).toBe(true);
    expect(readyLanguage({ ...view, cached: [{ tag: "fr", complete: false }] }, "fr")).toBe(false);
  });

  it("offers to finish the saved language when it still has English texts; Use stays off for a complete current one", async () => {
    const onPick = vi.fn();
    const { unmount } = await renderIn("en", <LanguagePicker current="es" view={{ ...view, language: "es", missing: 12, cached: [{ tag: "es", complete: false }] }} onPick={onPick} onClose={() => {}} />);
    expect(checked(screen.getByRole("radio", { name: /Español/ }))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenCalledWith("es");
    unmount();
    await renderIn("en", <LanguagePicker current="fr" view={{ ...view, language: "fr" }} onPick={() => {}} onClose={() => {}} />);
    expect(on(screen.getByRole("button", { name: "Use" }))).toBe(false);
  });

  it("disables the choices while a pick is pending, so two quick clicks can't race", async () => {
    let finish = () => {};
    const onPick = vi.fn(() => new Promise<void>((r) => (finish = r)));
    await renderIn("en", <LanguagePicker current="en" suggested="fr" view={view} onPick={onPick} onClose={() => {}} />);
    const use = screen.getByRole("button", { name: "Use" });
    fireEvent.click(use);
    fireEvent.click(use);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(on(use)).toBe(false);
    expect(on(screen.getByRole("radio", { name: /English/ }))).toBe(false);
    await act(async () => finish());
    expect(on(use)).toBe(true);
  });

  it("Escape closes without reaching the sheet; Tab stays inside; focus returns to the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const sheetKey = vi.fn();
    document.body.addEventListener("keydown", sheetKey);
    const { unmount } = await renderIn("en", <LanguagePicker current="en" view={view} onPick={() => {}} onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const use = screen.getByRole("button", { name: "Use" });
    // Use is disabled (nothing new picked), so Cancel is the last focusable: Tab from it wraps to the search.
    expect(on(use)).toBe(false);
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(sheetKey).not.toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(opener);
    document.body.removeEventListener("keydown", sheetKey);
    opener.remove();
  });
});
