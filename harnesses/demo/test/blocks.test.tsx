// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import en from "../locales/en.json";
import es from "../locales/es.json";
import { DiagramBlock } from "../ui/DiagramBlock";
import { FilesBlock } from "../ui/FilesBlock";

afterEach(cleanup);

async function renderIn(language: "es" | "en", ui: ReactElement) {
  const i18n = await createI18n(language, { es, en });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}
const actions = (open: (path: string) => Promise<boolean> = async () => true) => ({ respond: () => true, choose: () => true, open, active: true });

describe("DiagramBlock", () => {
  it("draws the boxes in order and lists the other edges under them", async () => {
    const data = {
      title: "A turn",
      nodes: [{ id: "ui", label: "Screen", detail: "ui" }, { id: "shell", label: "Main process" }, { id: "rt", label: "Runtime" }],
      edges: [{ from: "ui", to: "shell" }, { from: "shell", to: "rt" }, { from: "rt", to: "ui", label: "events come back" }],
    };
    await renderIn("en", <DiagramBlock data={data} {...actions()} />);
    const figure = screen.getByRole("figure", { name: "A turn" });
    expect([...figure.querySelectorAll(".demo-node strong")].map((n) => n.textContent)).toEqual(["Screen", "Main process", "Runtime"]);
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.getByText("Runtime → Screen: events come back")).toBeTruthy();
  });

  it("shows nothing for malformed data", async () => {
    const { container } = await renderIn("en", <DiagramBlock data={{ nodes: "x" }} {...actions()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("FilesBlock", () => {
  it("lists each file with its role and opens it in the editor", async () => {
    const open = vi.fn(async () => true);
    await renderIn("es", <FilesBlock data={{ files: [{ path: "packages/runtime/src/runtime.ts", role: "elige el transporte" }] }} {...actions(open)} />);
    expect(screen.getByRole("article", { name: "Dónde está en el código" })).toBeTruthy();
    expect(screen.getByText("elige el transporte")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir packages/runtime/src/runtime.ts en el editor" }));
    expect(open).toHaveBeenCalledWith("packages/runtime/src/runtime.ts");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when a file can't be opened", async () => {
    await renderIn("en", <FilesBlock data={{ files: [{ path: "x.md", role: "r" }] }} {...actions(async () => false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open x.md in the editor" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't open x.md.");
  });
});
