// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { TranslateNotice } from "../src/TranslateNotice";
import { renderIn } from "./render";

afterEach(cleanup);

describe("TranslateNotice (spec §4)", () => {
  it("says what runs, on which engine, that legal texts stay English; Cancel is focused; nothing runs until Translate", async () => {
    const onTranslate = vi.fn();
    const onCancel = vi.fn();
    await renderIn("en", <TranslateNotice tag="pt-BR" harnessName="Demo" engineName="Claude Code" onTranslate={onTranslate} onCancel={onCancel} />);
    const d = screen.getByRole("alertdialog", { name: "Translate the app?" });
    expect(d.textContent).toContain("To show Demo in Português (Brasil), your AI engine (Claude Code) will translate the app's texts.");
    expect(d.textContent).toContain("Legal texts stay in English.");
    expect(screen.getByText("Português (Brasil)").tagName).toBe("STRONG");
    expect(screen.getByText("Português (Brasil)").getAttribute("lang")).toBe("pt-BR");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(onTranslate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(onTranslate).toHaveBeenCalledOnce();
    fireEvent.keyDown(d, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows markup in the harness or engine name as text, and makes no element from it", async () => {
    await renderIn("en", <TranslateNotice tag="es" harnessName="<i>Demo</i> <b>x</b>" engineName="<img src=x>" onTranslate={() => {}} onCancel={() => {}} />);
    const d = screen.getByRole("alertdialog");
    expect(d.textContent).toContain("To show <i>Demo</i> <b>x</b> in Español, your AI engine (<img src=x>) will translate");
    expect(d.querySelector("i, img")).toBeNull();
    expect(d.querySelectorAll("strong")).toHaveLength(2);
  });

  it("uses a cached translation of the notice and keeps its one bold word", async () => {
    const i18n = await createI18n("es", {}, {
      "core:language.noticeTitle": "¿Traducir la app?",
      "core:language.notice": "Para mostrar {{name}} en <b>{{language}}</b>, {{engine}} traducirá los textos.",
    });
    render(
      <I18nextProvider i18n={i18n}>
        <TranslateNotice tag="es" harnessName="Demo" engineName="Codex" onTranslate={() => {}} onCancel={() => {}} />
      </I18nextProvider>,
    );
    const d = screen.getByRole("alertdialog", { name: "¿Traducir la app?" });
    expect(d.textContent).toContain("Para mostrar Demo en Español, Codex traducirá los textos.");
    expect(screen.getByText("Español").tagName).toBe("STRONG");
  });

  it("shows any tag other than b as text, even the basic ones i18next would keep (transKeepBasicHtmlNodesFor: [])", async () => {
    const i18n = await createI18n("es", {}, { "core:language.notice": "<strong>Ya</strong> <i>mostrar</i> {{name}}<br/> en <b>{{language}}</b>." });
    render(
      <I18nextProvider i18n={i18n}>
        <TranslateNotice tag="es" harnessName="Demo" engineName="Codex" onTranslate={() => {}} onCancel={() => {}} />
      </I18nextProvider>,
    );
    const d = screen.getByRole("alertdialog");
    expect(d.textContent).toContain("<strong>Ya</strong> <i>mostrar</i> Demo<br/> en Español.");
    expect(d.querySelector("i, br")).toBeNull();
    expect(d.querySelectorAll("strong")).toHaveLength(2);
  });

  it("keeps Tab inside and gives focus back to the opener when it closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = await renderIn("en", <TranslateNotice tag="es" harnessName="Demo" engineName="Claude Code" onTranslate={() => {}} onCancel={() => {}} />);
    const d = screen.getByRole("alertdialog");
    const translate = screen.getByRole("button", { name: "Translate" });
    translate.focus();
    fireEvent.keyDown(translate, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(d, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(translate);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
