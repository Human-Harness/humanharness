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
const actions = (open: (path: string) => Promise<boolean> = async () => true, reveal: (path: string) => Promise<boolean> = async () => true) => ({
  respond: () => true,
  choose: () => true,
  open,
  reveal,
  active: true,
});

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
  it("lists each file with its role: opens what the app can open, and shows source files in Finder", async () => {
    const open = vi.fn(async () => true);
    const reveal = vi.fn(async () => true);
    const files = [
      { path: "docs/architecture/turn.md", role: "la explicación" },
      { path: "packages/runtime/src/runtime.ts", role: "elige el transporte" },
    ];
    await renderIn("es", <FilesBlock data={{ files }} {...actions(open, reveal)} />);
    expect(screen.getByRole("article", { name: "Dónde está en el código" })).toBeTruthy();
    expect(screen.getByText("elige el transporte")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir packages/runtime/src/runtime.ts en el editor" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir docs/architecture/turn.md en el editor" }));
    expect(open).toHaveBeenCalledWith("docs/architecture/turn.md");
    const show = screen.getByRole("button", { name: "Mostrar packages/runtime/src/runtime.ts en Finder" });
    expect(show.textContent).toBe("Mostrar en Finder");
    fireEvent.click(show);
    expect(reveal).toHaveBeenCalledWith("packages/runtime/src/runtime.ts");
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when a file can't be shown in Finder", async () => {
    await renderIn("en", <FilesBlock data={{ files: [{ path: "x.ts", role: "r" }] }} {...actions(async () => true, async () => false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show x.ts in Finder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't show x.ts in Finder.");
  });

  it("says when a file can't be opened", async () => {
    await renderIn("en", <FilesBlock data={{ files: [{ path: "x.md", role: "r" }] }} {...actions(async () => false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open x.md in the editor" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't open x.md.");
  });
});
