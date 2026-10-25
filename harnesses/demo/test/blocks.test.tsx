// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@humanharness/i18n";
import en from "../locales/en.json";
import { DiagramBlock } from "../ui/DiagramBlock";
import { FilesBlock } from "../ui/FilesBlock";

afterEach(cleanup);

async function renderIn(ui: ReactElement) {
  const i18n = await createI18n("en", { en });
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
    await renderIn(<DiagramBlock data={data} {...actions()} />);
    const figure = screen.getByRole("figure", { name: "A turn" });
    expect([...figure.querySelectorAll(".demo-node strong")].map((n) => n.textContent)).toEqual(["Screen", "Main process", "Runtime"]);
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.getByText("Runtime → Screen: events come back")).toBeTruthy();
  });

  it("puts each arrow after its box, so wrapped rows never start with an arrow", async () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, label: `${id}-veryLongIdentifierWithoutSpaces`, detail: "detail" }));
    await renderIn(<DiagramBlock data={{ title: "Six", nodes, edges: [] }} {...actions()} />);
    const items = [...screen.getByRole("figure", { name: "Six" }).querySelectorAll("ol.demo-nodes > li.demo-node-item")];
    expect(items).toHaveLength(6);
    for (const [i, li] of items.entries()) {
      expect([...li.children].map((c) => c.getAttribute("class"))).toEqual(["demo-node", i === 5 ? "demo-arrow demo-arrow-end" : "demo-arrow"]);
    }
  });

  it("lays the boxes on a wrapping grid whose boxes shrink and wrap their text", () => {
    const css = readFileSync(resolve(__dirname, "../ui/demo.css"), "utf8");
    const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".demo-nodes")).toMatch(/display: grid;.*grid-template-columns: repeat\(auto-fit, minmax\(min\(\d+px, 100%\), 1fr\)\)/);
    expect(rule(".demo-node-item")).toMatch(/min-width: 0/);
    expect(rule(".demo-node")).toMatch(/min-width: 0/);
    expect(rule(".demo-node")).toMatch(/overflow-wrap: anywhere/);
    expect(rule(".demo-node-item svg")).toMatch(/flex: none/);
  });

  it("shows nothing for malformed data", async () => {
    const { container } = await renderIn(<DiagramBlock data={{ nodes: "x" }} {...actions()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("FilesBlock", () => {
  it("lists each file with its role: opens what the app can open, and shows source files in Finder", async () => {
    const open = vi.fn(async () => true);
    const reveal = vi.fn(async () => true);
    const files = [
      { path: "docs/architecture/turn.md", role: "the explanation" },
      { path: "packages/runtime/src/runtime.ts", role: "picks the transport" },
    ];
    await renderIn(<FilesBlock data={{ files }} {...actions(open, reveal)} />);
    expect(screen.getByRole("article", { name: "Where it is in the code" })).toBeTruthy();
    expect(screen.getByText("picks the transport")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open packages/runtime/src/runtime.ts in the editor" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open docs/architecture/turn.md in the editor" }));
    expect(open).toHaveBeenCalledWith("docs/architecture/turn.md");
    const show = screen.getByRole("button", { name: "Show packages/runtime/src/runtime.ts in Finder" });
    expect(show.textContent).toBe("Show in Finder");
    fireEvent.click(show);
    expect(reveal).toHaveBeenCalledWith("packages/runtime/src/runtime.ts");
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when a file can't be shown in Finder", async () => {
    await renderIn(<FilesBlock data={{ files: [{ path: "x.ts", role: "r" }] }} {...actions(async () => true, async () => false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show x.ts in Finder" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't show x.ts in Finder.");
  });

  it("says when a file can't be opened", async () => {
    await renderIn(<FilesBlock data={{ files: [{ path: "x.md", role: "r" }] }} {...actions(async () => false)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open x.md in the editor" }));
    expect((await screen.findByRole("alert")).textContent).toBe("I couldn't open x.md.");
  });
});
